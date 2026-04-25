class RedisPresenceStore {
  constructor(client, options = {}) {
    this.client = client;
    this.keyPrefix = String(options.keyPrefix || "tirthsutra");
    this.ttlSeconds = Math.max(30, Number(options.ttlSeconds) || 90);
    this.userSetTtlSeconds = Math.max(
      this.ttlSeconds + 30,
      this.ttlSeconds * 2
    );
    this.onlineUsersSetKey = `${this.keyPrefix}:presence:users`;
  }

  normalizeId(value) {
    return value ? value.toString() : "";
  }

  socketKey(socketId) {
    return `${this.keyPrefix}:presence:socket:${socketId}`;
  }

  userSocketsKey(userId) {
    return `${this.keyPrefix}:presence:user:${userId}:sockets`;
  }

  async addSocket(userId, socketId) {
    const uid = this.normalizeId(userId);
    const sid = this.normalizeId(socketId);
    if (!uid || !sid) return;

    const userKey = this.userSocketsKey(uid);
    await this.client
      .multi()
      .set(this.socketKey(sid), uid, { EX: this.ttlSeconds })
      .sAdd(userKey, sid)
      .expire(userKey, this.userSetTtlSeconds)
      .sAdd(this.onlineUsersSetKey, uid)
      .exec();
  }

  async touchSocket(userId, socketId) {
    const uid = this.normalizeId(userId);
    const sid = this.normalizeId(socketId);
    if (!uid || !sid) return;

    const userKey = this.userSocketsKey(uid);
    await this.client
      .multi()
      .set(this.socketKey(sid), uid, { EX: this.ttlSeconds })
      .sAdd(userKey, sid)
      .expire(userKey, this.userSetTtlSeconds)
      .sAdd(this.onlineUsersSetKey, uid)
      .exec();
  }

  async removeSocket(userId, socketId) {
    const uid = this.normalizeId(userId);
    const sid = this.normalizeId(socketId);
    if (!uid || !sid) return false;

    const userKey = this.userSocketsKey(uid);
    await this.client
      .multi()
      .del(this.socketKey(sid))
      .sRem(userKey, sid)
      .exec();

    const activeSocketIds = await this.cleanupUser(uid);
    return activeSocketIds.length > 0;
  }

  async isOnline(userId) {
    const activeSocketIds = await this.cleanupUser(userId);
    return activeSocketIds.length > 0;
  }

  async getOnlineUserIds() {
    const userIds = await this.client.sMembers(this.onlineUsersSetKey);
    if (!userIds.length) return [];

    const activeUserIds = [];
    for (const userId of userIds) {
      if (await this.isOnline(userId)) {
        activeUserIds.push(userId);
      }
    }

    return activeUserIds;
  }

  async cleanupUser(userId) {
    const uid = this.normalizeId(userId);
    if (!uid) return [];

    const userKey = this.userSocketsKey(uid);
    const socketIds = await this.client.sMembers(userKey);
    if (!socketIds.length) {
      await this.client.sRem(this.onlineUsersSetKey, uid);
      return [];
    }

    const existsBatch = this.client.multi();
    socketIds.forEach((socketId) => existsBatch.exists(this.socketKey(socketId)));
    const existsReplies = await existsBatch.exec();

    const activeSocketIds = [];
    const staleSocketIds = [];
    socketIds.forEach((socketId, index) => {
      const exists = Number(existsReplies?.[index] || 0) > 0;
      if (exists) activeSocketIds.push(socketId);
      else staleSocketIds.push(socketId);
    });

    if (staleSocketIds.length) {
      await this.client.sRem(userKey, staleSocketIds);
    }

    if (!activeSocketIds.length) {
      await this.client.multi().del(userKey).sRem(this.onlineUsersSetKey, uid).exec();
      return [];
    }

    if (staleSocketIds.length) {
      await this.client
        .multi()
        .expire(userKey, this.userSetTtlSeconds)
        .sAdd(this.onlineUsersSetKey, uid)
        .exec();
    }

    return activeSocketIds;
  }
}

module.exports = RedisPresenceStore;
