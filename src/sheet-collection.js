export const sheetCollection = Object.freeze({
  event: 'coact:sheet',
  snapshot: (room) => ({ ...room.sheet.cells }),
  get: (room, key) => room.sheet.cells[String(key).toUpperCase()],
  set: (room, key, value) => room.updateSheetCell(key, value),
  replace: (room, values) => room.replaceSheet(values),
  select: (room, key) => room.selectSheetCell(key)
});
