import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import { createServer } from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("data.db");

// Initialize Database with extended schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE,
    password TEXT,
    avatar TEXT,
    role TEXT DEFAULT 'buyer' -- 'buyer', 'seller', 'courier'
  );

  CREATE TABLE IF NOT EXISTS addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    recipient_name TEXT,
    phone TEXT,
    address_line TEXT,
    city TEXT,
    province TEXT,
    postal_code TEXT,
    is_primary INTEGER DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id INTEGER,
    name TEXT,
    price REAL,
    discount REAL,
    category TEXT,
    description TEXT,
    image TEXT,
    rating REAL,
    stock INTEGER,
    FOREIGN KEY(seller_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    seller_id INTEGER,
    courier_id INTEGER,
    address_id INTEGER,
    total REAL,
    status TEXT, -- 'Pending', 'Paid', 'Confirmed', 'Packing', 'Shipped', 'In Transit', 'Out for Delivery', 'Delivered'
    tracking_history TEXT, -- JSON array of events
    estimated_arrival TEXT,
    delivery_proof_image TEXT,
    delivered_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(seller_id) REFERENCES users(id),
    FOREIGN KEY(courier_id) REFERENCES users(id),
    FOREIGN KEY(address_id) REFERENCES addresses(id)
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    product_id INTEGER,
    quantity INTEGER,
    price REAL,
    FOREIGN KEY(order_id) REFERENCES orders(id),
    FOREIGN KEY(product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS chat_rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    buyer_id INTEGER,
    seller_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(buyer_id, seller_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER,
    sender_id INTEGER,
    text TEXT,
    image TEXT,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(room_id) REFERENCES chat_rooms(id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    title TEXT,
    message TEXT,
    type TEXT, -- 'order', 'chat', 'system'
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// Migrations for existing databases
const migrate = (table: string, column: string, type: string) => {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    console.log(`Migrated: Added ${column} to ${table}`);
  } catch (e) {
    // Column likely already exists
  }
};

migrate('orders', 'seller_id', 'INTEGER');
migrate('orders', 'courier_id', 'INTEGER');
migrate('orders', 'address_id', 'INTEGER');
migrate('orders', 'tracking_history', 'TEXT');
migrate('orders', 'estimated_arrival', 'TEXT');
migrate('orders', 'delivery_proof_image', 'TEXT');
migrate('orders', 'delivered_at', 'DATETIME');

// Seed initial users if empty
const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
if (userCount.count === 0) {
  const insertUser = db.prepare("INSERT INTO users (name, email, password, avatar, role) VALUES (?, ?, ?, ?, ?)");
  insertUser.run("Admin Seller", "seller@luxe.com", "password", "https://api.dicebear.com/7.x/avataaars/svg?seed=Seller", "seller");
  insertUser.run("John Courier", "courier@luxe.com", "password", "https://api.dicebear.com/7.x/avataaars/svg?seed=Courier", "courier");
  insertUser.run("Jane Buyer", "buyer@luxe.com", "password", "https://api.dicebear.com/7.x/avataaars/svg?seed=Buyer", "buyer");
}

// Seed initial addresses if empty
const addressCount = db.prepare("SELECT COUNT(*) as count FROM addresses").get() as { count: number };
if (addressCount.count === 0) {
  const buyer = db.prepare("SELECT id FROM users WHERE email = 'buyer@luxe.com'").get() as { id: number };
  if (buyer) {
    const insertAddress = db.prepare("INSERT INTO addresses (user_id, recipient_name, phone, address_line, city, province, postal_code, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    insertAddress.run(buyer.id, "Jane Buyer", "+62 812-3456-7890", "Jl. Kemang Raya No. 10", "Jakarta Selatan", "DKI Jakarta", "12730", 1);
    insertAddress.run(buyer.id, "Jane's Office", "+62 812-9876-5432", "Sudirman Central Business District, Tower A", "Jakarta Pusat", "DKI Jakarta", "12190", 0);
  }
}

// Seed Products if empty
const productCount = db.prepare("SELECT COUNT(*) as count FROM products").get() as { count: number };
if (productCount.count === 0) {
  const seller = db.prepare("SELECT id FROM users WHERE role = 'seller'").get() as { id: number };
  const insertProduct = db.prepare("INSERT INTO products (seller_id, name, price, discount, category, description, image, rating, stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  
  const seedProducts = [
    // Men (10 items)
    [seller.id, "Classic Black Blazer", 299.99, 0, "men", "Premium wool blend blazer for a sharp look.", "https://picsum.photos/seed/blazer/800/1000", 4.8, 10],
    [seller.id, "White Linen Shirt", 89.99, 0, "men", "Breathable linen shirt for summer elegance.", "https://picsum.photos/seed/shirt/800/1000", 4.5, 20],
    [seller.id, "Oxford Leather Shoes", 249.99, 0, "men", "Classic formal shoes in premium leather.", "https://picsum.photos/seed/shoes/800/1000", 4.7, 10],
    [seller.id, "Navy Tailored Trousers", 149.99, 0, "men", "Slim-fit trousers for the modern gentleman.", "https://picsum.photos/seed/trousers/800/1000", 4.6, 15],
    [seller.id, "Suede Chelsea Boots", 189.99, 15, "men", "Elegant suede boots for a versatile style.", "https://picsum.photos/seed/boots/800/1000", 4.8, 12],
    [seller.id, "Merino Wool Polo", 119.99, 0, "men", "Soft merino wool polo for smart-casual days.", "https://picsum.photos/seed/polo/800/1000", 4.7, 18],
    [seller.id, "Leather Biker Jacket", 499.99, 0, "men", "Rugged yet refined premium leather jacket.", "https://picsum.photos/seed/jacket/800/1000", 4.9, 5],
    [seller.id, "Cotton Chino Shorts", 69.99, 0, "men", "Classic cotton chinos for a relaxed summer.", "https://picsum.photos/seed/shorts/800/1000", 4.4, 25],
    [seller.id, "Silk Necktie", 79.99, 0, "men", "Hand-finished silk tie with a subtle pattern.", "https://picsum.photos/seed/tie/800/1000", 4.8, 30],
    [seller.id, "Denim Trucker Jacket", 129.99, 10, "men", "Timeless denim jacket with a vintage wash.", "https://picsum.photos/seed/denim/800/1000", 4.6, 14],

    // Women (10 items)
    [seller.id, "Silk Evening Gown", 549.99, 10, "women", "Elegant silk gown for special occasions.", "https://picsum.photos/seed/gown/800/1000", 4.9, 5],
    [seller.id, "Cashmere Sweater", 159.99, 0, "women", "Ultra-soft cashmere for cold days.", "https://picsum.photos/seed/sweater/800/1000", 4.6, 12],
    [seller.id, "Floral Summer Dress", 129.99, 0, "women", "Lightweight floral dress for sunny afternoons.", "https://picsum.photos/seed/dress/800/1000", 4.7, 15],
    [seller.id, "Tailored Wool Coat", 349.99, 0, "women", "Classic wool coat with a structured silhouette.", "https://picsum.photos/seed/coat/800/1000", 4.8, 8],
    [seller.id, "Satin Slip Skirt", 89.99, 20, "women", "Elegant satin skirt for a fluid look.", "https://picsum.photos/seed/skirt/800/1000", 4.5, 20],
    [seller.id, "Leather Ankle Boots", 219.99, 0, "women", "Chic leather boots with a comfortable heel.", "https://picsum.photos/seed/wboots/800/1000", 4.7, 10],
    [seller.id, "Linen Wrap Top", 74.99, 0, "women", "Breathable linen top with a flattering wrap.", "https://picsum.photos/seed/top/800/1000", 4.6, 22],
    [seller.id, "Velvet Party Dress", 199.99, 0, "women", "Luxurious velvet dress for evening events.", "https://picsum.photos/seed/velvet/800/1000", 4.8, 6],
    [seller.id, "Wide-Leg Trousers", 119.99, 0, "women", "Sophisticated wide-leg trousers in crepe.", "https://picsum.photos/seed/wtrousers/800/1000", 4.5, 14],
    [seller.id, "Embroidered Blouse", 94.99, 10, "women", "Delicate embroidery on a soft cotton base.", "https://picsum.photos/seed/blouse/800/1000", 4.7, 16],

    // Accessories
    [seller.id, "Gold Minimalist Watch", 199.99, 0, "accessories", "Timeless gold-plated watch with a leather strap.", "https://picsum.photos/seed/watch/800/1000", 4.7, 15],
    [seller.id, "Leather Handbag", 399.99, 15, "accessories", "Handcrafted Italian leather bag.", "https://picsum.photos/seed/bag/800/1000", 4.8, 8],
    [seller.id, "Diamond Stud Earrings", 899.99, 5, "accessories", "18k gold with ethically sourced diamonds.", "https://picsum.photos/seed/earrings/800/1000", 5.0, 3],
  ];

  seedProducts.forEach(p => insertProduct.run(...p));
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer);
  const PORT = 3000;

  app.use(express.json());

  // Socket.io logic
  io.on("connection", (socket) => {
    socket.on("join_room", (roomId) => {
      socket.join(`room_${roomId}`);
    });

    socket.on("join_user", (userId) => {
      socket.join(`user_${userId}`);
    });

    socket.on("send_message", (data) => {
      const { room_id, sender_id, text, image, receiver_id } = data;
      const info = db.prepare("INSERT INTO messages (room_id, sender_id, text, image) VALUES (?, ?, ?, ?)").run(room_id, sender_id, text, image);
      const message = db.prepare("SELECT * FROM messages WHERE id = ?").get(info.lastInsertRowid);
      
      io.to(`room_${room_id}`).emit("new_message", message);
      io.to(`user_${receiver_id}`).emit("notification", {
        title: "New Message",
        message: text || "Sent an image",
        type: "chat"
      });
    });
  });

  // API Routes
  app.get("/api/products", (req, res) => {
    const products = db.prepare("SELECT * FROM products").all();
    res.json(products);
  });

  app.get("/api/products/:id", (req, res) => {
    const product = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
    if (product) res.json(product);
    else res.status(404).json({ error: "Product not found" });
  });

  app.post("/api/products", (req, res) => {
    const { seller_id, name, price, discount, category, description, image, stock } = req.body;
    const info = db.prepare("INSERT INTO products (seller_id, name, price, discount, category, description, image, rating, stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(seller_id, name, price, discount, category, description, image, 5.0, stock);
    res.json({ id: info.lastInsertRowid });
  });

  app.put("/api/products/:id", (req, res) => {
    const { name, price, discount, category, description, image, stock } = req.body;
    db.prepare("UPDATE products SET name = ?, price = ?, discount = ?, category = ?, description = ?, image = ?, stock = ? WHERE id = ?").run(name, price, discount, category, description, image, stock, req.params.id);
    res.json({ success: true });
  });

  app.delete("/api/products/:id", (req, res) => {
    db.prepare("DELETE FROM products WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  app.post("/api/auth/register", (req, res) => {
    const { name, email, password, role } = req.body;
    try {
      const info = db.prepare("INSERT INTO users (name, email, password, avatar, role) VALUES (?, ?, ?, ?, ?)").run(name, email, password, `https://api.dicebear.com/7.x/avataaars/svg?seed=${name}`, role || 'buyer');
      const user = db.prepare("SELECT id, name, email, avatar, role FROM users WHERE id = ?").get(info.lastInsertRowid);
      res.json(user);
    } catch (e) {
      res.status(400).json({ error: "Email already exists" });
    }
  });

  app.post("/api/auth/login", (req, res) => {
    const { email, password } = req.body;
    const user = db.prepare("SELECT id, name, email, avatar, role FROM users WHERE email = ? AND password = ?").get(email, password);
    if (user) res.json(user);
    else res.status(401).json({ error: "Invalid credentials" });
  });

  // Addresses
  app.get("/api/addresses/:userId", (req, res) => {
    const addresses = db.prepare("SELECT * FROM addresses WHERE user_id = ?").all(req.params.userId);
    res.json(addresses);
  });

  app.post("/api/addresses", (req, res) => {
    const { user_id, recipient_name, phone, address_line, city, province, postal_code, is_primary } = req.body;
    if (is_primary) {
      db.prepare("UPDATE addresses SET is_primary = 0 WHERE user_id = ?").run(user_id);
    }
    const info = db.prepare("INSERT INTO addresses (user_id, recipient_name, phone, address_line, city, province, postal_code, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(user_id, recipient_name, phone, address_line, city, province, postal_code, is_primary ? 1 : 0);
    res.json({ id: info.lastInsertRowid });
  });

  app.delete("/api/addresses/:id", (req, res) => {
    db.prepare("DELETE FROM addresses WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  app.put("/api/addresses/:id/primary", (req, res) => {
    const address = db.prepare("SELECT user_id FROM addresses WHERE id = ?").get(req.params.id) as any;
    if (address) {
      db.prepare("UPDATE addresses SET is_primary = 0 WHERE user_id = ?").run(address.user_id);
      db.prepare("UPDATE addresses SET is_primary = 1 WHERE id = ?").run(req.params.id);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Address not found" });
    }
  });

  // Orders
  app.post("/api/orders", (req, res) => {
    const { user_id, items, total, address_id } = req.body;
    const seller_id = items[0].seller_id; // Simple assumption: one seller per order for now
    const tracking_history = JSON.stringify([{ status: 'Paid', location: 'Payment Confirmed', timestamp: new Date().toISOString() }]);
    
    const insertOrder = db.prepare("INSERT INTO orders (user_id, seller_id, total, status, address_id, tracking_history) VALUES (?, ?, ?, ?, ?, ?)");
    const insertItem = db.prepare("INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)");

    const transaction = db.transaction(() => {
      const info = insertOrder.run(user_id, seller_id, total, "Paid", address_id, tracking_history);
      const orderId = info.lastInsertRowid;
      for (const item of items) {
        insertItem.run(orderId, item.id, item.quantity, item.price);
      }
      return orderId;
    });

    const orderId = transaction();
    
    // Notify Seller
    io.to(`user_${seller_id}`).emit("notification", {
      title: "New Order",
      message: `You have a new order #${orderId}`,
      type: "order"
    });

    res.json({ success: true, orderId });
  });

  app.get("/api/orders/user/:userId", (req, res) => {
    const orders = db.prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC").all(req.params.userId);
    res.json(orders);
  });

  app.get("/api/orders/seller/:sellerId", (req, res) => {
    const orders = db.prepare("SELECT * FROM orders WHERE seller_id = ? ORDER BY created_at DESC").all(req.params.sellerId);
    res.json(orders);
  });

  app.get("/api/orders/courier/:courierId", (req, res) => {
    const orders = db.prepare("SELECT * FROM orders WHERE courier_id = ? OR (courier_id IS NULL AND status = 'Shipped') ORDER BY created_at DESC").all(req.params.courierId);
    res.json(orders);
  });

  app.get("/api/orders/:id", (req, res) => {
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id) as any;
    if (!order) return res.status(404).json({ error: "Order not found" });
    
    const items = db.prepare("SELECT oi.*, p.name, p.image FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?").all(req.params.id);
    const address = order.address_id ? db.prepare("SELECT * FROM addresses WHERE id = ?").get(order.address_id) : null;
    res.json({ ...order, items, address });
  });

  app.put("/api/orders/:id/status", (req, res) => {
    const { status, location, courier_id, estimated_arrival, delivery_proof_image } = req.body;
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id) as any;
    const history = JSON.parse(order.tracking_history);
    history.push({ status, location, timestamp: new Date().toISOString() });
    
    let query = "UPDATE orders SET status = ?, tracking_history = ?";
    const params = [status, JSON.stringify(history)];

    if (courier_id) { query += ", courier_id = ?"; params.push(courier_id); }
    if (estimated_arrival) { query += ", estimated_arrival = ?"; params.push(estimated_arrival); }
    if (delivery_proof_image) { query += ", delivery_proof_image = ?"; params.push(delivery_proof_image); }
    if (status === 'Delivered') { query += ", delivered_at = CURRENT_TIMESTAMP"; }

    query += " WHERE id = ?";
    params.push(req.params.id);

    db.prepare(query).run(...params);

    // Notify Buyer
    io.to(`user_${order.user_id}`).emit("notification", {
      title: "Order Update",
      message: `Your order #${req.params.id} is now ${status}`,
      type: "order"
    });

    res.json({ success: true });
  });

  // Chat
  app.get("/api/chat/rooms/:userId", (req, res) => {
    const rooms = db.prepare(`
      SELECT cr.*, u.name as other_name, u.avatar as other_avatar, u.id as other_id
      FROM chat_rooms cr
      JOIN users u ON (cr.buyer_id = u.id OR cr.seller_id = u.id)
      WHERE (cr.buyer_id = ? OR cr.seller_id = ?) AND u.id != ?
    `).all(req.params.userId, req.params.userId, req.params.userId);
    res.json(rooms);
  });

  app.get("/api/chat/messages/:roomId", (req, res) => {
    const messages = db.prepare("SELECT * FROM messages WHERE room_id = ? ORDER BY created_at ASC").all(req.params.roomId);
    res.json(messages);
  });

  app.post("/api/chat/rooms", (req, res) => {
    const { buyer_id, seller_id } = req.body;
    try {
      const info = db.prepare("INSERT INTO chat_rooms (buyer_id, seller_id) VALUES (?, ?)").run(buyer_id, seller_id);
      res.json({ id: info.lastInsertRowid });
    } catch (e) {
      const room = db.prepare("SELECT id FROM chat_rooms WHERE buyer_id = ? AND seller_id = ?").get(buyer_id, seller_id);
      res.json(room);
    }
  });

  // Stats for Seller
  app.get("/api/seller/stats/:sellerId", (req, res) => {
    const totalProducts = db.prepare("SELECT COUNT(*) as count FROM products WHERE seller_id = ?").get(req.params.sellerId) as any;
    const totalSales = db.prepare("SELECT COUNT(*) as count FROM orders WHERE seller_id = ? AND status = 'Delivered'").get(req.params.sellerId) as any;
    const totalRevenue = db.prepare("SELECT SUM(total) as sum FROM orders WHERE seller_id = ? AND status = 'Delivered'").get(req.params.sellerId) as any;
    
    const salesByDay = db.prepare(`
      SELECT DATE(created_at) as date, SUM(total) as total
      FROM orders
      WHERE seller_id = ? AND status = 'Delivered'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 7
    `).all(req.params.sellerId);

    res.json({
      totalProducts: totalProducts.count,
      totalSales: totalSales.count,
      totalRevenue: totalRevenue.sum || 0,
      salesByDay: salesByDay.reverse()
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
