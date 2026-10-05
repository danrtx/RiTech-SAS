// Atomic index/payload/metadata updates; all three keys share a Redis hash slot.
const prune = `
local function evict(ids)
  for _, id in ipairs(ids) do
    local score = tonumber(redis.call('ZSCORE', KEYS[1], id))
    local coverage = (math.floor(score / 60000) + 1) * 60000
    local prior = tonumber(redis.call('HGET', KEYS[3], 'coverage') or '0')
    if coverage > prior then redis.call('HSET', KEYS[3], 'coverage', coverage) end
    redis.call('ZREM', KEYS[1], id)
    redis.call('HDEL', KEYS[2], id)
  end
end
local function trim(cutoff, capacity)
  evict(redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', '(' .. string.format('%.0f', cutoff)))
  local excess = redis.call('ZCARD', KEYS[1]) - capacity
  if excess > 0 then evict(redis.call('ZRANGE', KEYS[1], 0, excess - 1)) end
end
`;
export const APPEND_TICK =
  prune +
  `
local tick = cjson.decode(ARGV[1])
local cutoff = tonumber(ARGV[2])
local capacity = tonumber(ARGV[3])
if redis.call('HEXISTS', KEYS[2], tick.id) == 1 then return 'duplicate' end
if tick.eventTime < cutoff then return 'expired' end
local closed = tonumber(redis.call('HGET', KEYS[3], 'closed') or '0')
if ARGV[5] ~= 'recovery' and tick.eventTime < closed then return 'late' end
local previous = tonumber(redis.call('HGET', KEYS[3], 'last') or '0')
if ARGV[5] ~= 'recovery' and tick.eventTime < previous then return 'outOfOrder' end
local sequence = redis.call('HINCRBY', KEYS[3], 'sequence', 1)
redis.call('HSET', KEYS[3], 'last', string.format('%.0f', math.max(previous, tick.eventTime)))
-- Retain the original JSON number precision; Lua cjson re-encoding rounds doubles.
redis.call('HSET', KEYS[2], tick.id, '{"sequence":' .. string.format('%.0f', sequence) .. ',"tick":' .. ARGV[1] .. '}')
redis.call('ZADD', KEYS[1], tick.eventTime, tick.id)
trim(cutoff, capacity)
for _, key in ipairs(KEYS) do redis.call('EXPIRE', key, ARGV[4]) end
return 'accepted'
`;
export const READ_TICKS =
  prune +
  `
trim(tonumber(ARGV[3]), tonumber(ARGV[4]))
local boundary = tonumber(ARGV[2])
local closed = tonumber(redis.call('HGET', KEYS[3], 'closed') or '0')
if boundary > closed then redis.call('HSET', KEYS[3], 'closed', ARGV[2]) end
redis.call('EXPIRE', KEYS[3], ARGV[5])
local result = { redis.call('HGET', KEYS[3], 'coverage') or '' }
local ids = redis.call('ZRANGEBYSCORE', KEYS[1], ARGV[1], '(' .. ARGV[2])
for _, id in ipairs(ids) do table.insert(result, redis.call('HGET', KEYS[2], id)) end
return result
`;
