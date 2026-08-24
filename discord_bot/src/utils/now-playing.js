function registry(client) {
  if (!client.currentTrackByGuild) client.currentTrackByGuild = new Map();
  return client.currentTrackByGuild;
}

function setCurrentTrack(client, guildId, track) {
  if (!client || !guildId || !track) return null;
  const stored = { ...track, guildId };
  registry(client).set(guildId, stored);
  return stored;
}

function clearCurrentTrack(client, guildId) {
  if (!client || !guildId) return false;
  return registry(client).delete(guildId);
}

function currentTrackFor(client, guildId) {
  if (!client || !guildId) return null;
  return registry(client).get(guildId) || null;
}

function anyCurrentTrack(client) {
  if (!client) return null;
  for (const track of registry(client).values()) return track;
  return null;
}

module.exports = { setCurrentTrack, clearCurrentTrack, currentTrackFor, anyCurrentTrack };
