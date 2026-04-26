function getVisibleAccountStatusFilter() {
  return {
    $or: [
      { accountStatus: "active" },
      { accountStatus: { $exists: false } },
      { accountStatus: null },
    ],
  };
}

module.exports = {
  getVisibleAccountStatusFilter,
};
