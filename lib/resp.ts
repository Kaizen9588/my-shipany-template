export function respData(data: any) {
  return respJson(0, "ok", data || []);
}

export function respOk() {
  return respJson(0, "ok");
}

export function respErr(message: string, status: number = 200) {
  return Response.json({ code: -1, message }, { status });
}

export function respJson(code: number, message: string, data?: any) {
  // P-1.8 问题 6：JSON.stringify 会丢弃 undefined 属性，无需手动条件赋值
  return Response.json({ code, message, data });
}
