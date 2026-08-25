export type ErrorCode =
  | "not_configured"
  | "ifind_auth_failed"
  | "permission_denied"
  | "quota_exceeded"
  | "rate_limited"
  | "security_not_found"
  | "ambiguous_security"
  | "no_data"
  | "invalid_request"
  | "upstream_unavailable"
  | "internal_error";

export class ServiceError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export function asServiceError(error: unknown): ServiceError {
  if (error instanceof ServiceError) return error;
  return new ServiceError("internal_error", "同花顺行情服务发生内部错误。", 500);
}

export function mapIfindFailure(value: unknown, status = 502): ServiceError {
  const record = asRecord(value);
  const rawCode = String(record?.errorcode ?? record?.errorCode ?? record?.code ?? "");
  const message = String(record?.errmsg ?? record?.errorMessage ?? record?.message ?? "iFinD 请求失败。");
  const text = `${rawCode} ${message}`.toLowerCase();
  if (status === 401 || /token|auth|login|登录|鉴权|凭据/.test(text)) {
    return new ServiceError("ifind_auth_failed", "iFinD 凭据无效或已过期，请重新配置 refresh token。", 401);
  }
  if (status === 429 || /rate|qps|频率|too many/.test(text)) {
    return new ServiceError("rate_limited", "iFinD 请求频率受限，请稍后重试。", 429);
  }
  if (/quota|流量|额度|exceed.*limit|data.*limit/.test(text)) {
    return new ServiceError("quota_exceeded", "iFinD 数据额度不足或已达到当前账户限制。", 429);
  }
  if (status === 403 || /permission|权限|无权|not authorized/.test(text)) {
    return new ServiceError("permission_denied", "当前 iFinD 账户没有访问该数据的权限。", 403);
  }
  return new ServiceError("upstream_unavailable", message || "iFinD 请求失败。", status, {
    upstreamCode: rawCode || undefined,
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
