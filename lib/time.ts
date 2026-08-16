export function getIsoTimestr(): string {
  return new Date().toISOString();
}

/** Unix 秒时间戳（单位：秒；P-1.8 问题 5 统一单位标注） */
export const getTimestamp = () => {
  let time = Date.parse(new Date().toUTCString());

  return time / 1000;
};

export const getOneYearLaterTimestr = () => {
  const currentDate = new Date();
  const oneYearLater = new Date(currentDate);
  oneYearLater.setFullYear(currentDate.getFullYear() + 1);

  return oneYearLater.toISOString();
};
