export class ApiResponse {
  constructor(statusCode, data = null, message = 'Operation completed successfully', meta = null) {
    this.statusCode = statusCode;
    this.success = true;
    this.message = message;
    this.data = data;
    this.meta = meta;
  }

  toJSON() {
    return {
      success: this.success,
      message: this.message,
      data: this.data,
      meta: this.meta,
    };
  }
}
