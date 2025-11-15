# Web Affiliate - Shopee Deal Management

Hệ thống quản lý và hiển thị sản phẩm deal từ Shopee với mapping link chuyển đổi.

## Cài đặt

1. Cài đặt dependencies:

```bash
npm install
```

2. Chạy server:

```bash
npm start
```

Hoặc chạy với nodemon (tự động restart khi có thay đổi):

```bash
npm run dev
```

3. Mở trình duyệt:

- Trang chính: http://localhost:3000
- Trang admin: http://localhost:3000/admin.html

## Cấu trúc

- `server.js` - Node.js server với SQLite database
- `data.db` - SQLite database file (tự động tạo)
- `admin.html` - Trang quản lý admin
- `index.html` - Trang hiển thị sản phẩm cho người dùng

## API Endpoints

- `GET /api/data` - Lấy tất cả dữ liệu
- `GET /api/data/:timeSlot` - Lấy dữ liệu theo khung giờ
- `POST /api/data` - Lưu dữ liệu cho một khung giờ
- `POST /api/data/batch` - Lưu nhiều khung giờ cùng lúc
- `DELETE /api/data/:timeSlot` - Xóa dữ liệu của một khung giờ
- `DELETE /api/data` - Xóa tất cả dữ liệu
