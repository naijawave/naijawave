// Shared realtime bus — lets REST routes push socket events.
let io = null;
module.exports = {
  setIo(instance) { io = instance; },
  getIo() { return io; },
  emitToUser(userId, event, data) {
    if (io) io.to('user:' + userId).emit(event, data);
  },
};
