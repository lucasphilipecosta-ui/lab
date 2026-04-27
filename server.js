const express = require('express');
const mysql   = require('mysql2/promise');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const cors    = require('cors');
const path    = require('path');

const app    = express();
const PORT   = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'lab_secret_2025';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ═══════════════════════════════════════════
//  CONEXÃO MYSQL (XAMPP)
// ═══════════════════════════════════════════
const pool = mysql.createPool({
  host:     process.env.MYSQLHOST     || process.env.DB_HOST     || 'localhost',
  port:     process.env.MYSQLPORT     || process.env.DB_PORT     || 3306,
  user:     process.env.MYSQLUSER     || process.env.DB_USER     || 'root',
  password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || '',
  database: process.env.MYSQLDATABASE || process.env.DB_NAME     || 'lab_calculadora',
  waitForConnections: true,
  connectionLimit:    10,
  timezone: '-03:00',  // Horário de Brasília (UTC-3)
});

// ═══════════════════════════════════════════
//  CRIAR TABELAS SE NÃO EXISTIREM
// ═══════════════════════════════════════════
async function initDB() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id               INT AUTO_INCREMENT PRIMARY KEY,
        nome             VARCHAR(100) NOT NULL UNIQUE,
        senha_hash       VARCHAR(255) NOT NULL,
        perfil           ENUM('baixo','alto','ambos') NOT NULL DEFAULT 'baixo',
        is_admin         TINYINT(1) NOT NULL DEFAULT 0,
        maquina_modelo   VARCHAR(150) DEFAULT '',
        maquina_serie    VARCHAR(150) DEFAULT '',
        maquina_tipo     VARCHAR(50)  DEFAULT 'stone',
        criado_em        DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS vendas (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        usuario_id   INT NOT NULL,
        valor_bruto  DECIMAL(12,2) NOT NULL,
        taxa         DECIMAL(6,2)  NOT NULL,
        desconto     DECIMAL(12,2) NOT NULL,
        liquido      DECIMAL(12,2) NOT NULL,
        parcela      VARCHAR(10)   NOT NULL,
        bandeira     VARCHAR(30)   NOT NULL,
        perfil       VARCHAR(10)   NOT NULL,
        maquina_tipo VARCHAR(30)   DEFAULT 'stone',
        criado_em    DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS taxas (
        id     INT AUTO_INCREMENT PRIMARY KEY,
        perfil VARCHAR(10)  NOT NULL,
        label  VARCHAR(20)  NOT NULL,
        vm     DECIMAL(6,2) NOT NULL,
        ea     DECIMAL(6,2) NOT NULL,
        UNIQUE KEY perfil_label (perfil, label)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS custos (
        id       INT AUTO_INCREMENT PRIMARY KEY,
        maquina  VARCHAR(30)  NOT NULL,
        label    VARCHAR(20)  NOT NULL,
        vm       DECIMAL(6,2) NOT NULL DEFAULT 0,
        ea       DECIMAL(6,2) NOT NULL DEFAULT 0,
        UNIQUE KEY maquina_label (maquina, label)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Adiciona coluna maquina_tipo se nao existir (compatibilidade)
    try {
      await conn.query("ALTER TABLE usuarios ADD COLUMN maquina_tipo VARCHAR(50) DEFAULT 'stone'");
      console.log('✓ Coluna maquina_tipo adicionada');
    } catch(e) { /* coluna ja existe */ }
    try {
      await conn.query("ALTER TABLE vendas ADD COLUMN maquina_tipo VARCHAR(30) DEFAULT 'stone'");
      console.log('✓ Coluna maquina_tipo adicionada em vendas');
    } catch(e) { /* coluna ja existe */ }

    console.log('✓ Tabelas verificadas/criadas');
    await seedUsuarios(conn);
    await seedTaxas(conn);
    await seedCustos(conn);
  } finally {
    conn.release();
  }
}

// ═══════════════════════════════════════════
//  SEED USUÁRIOS
// ═══════════════════════════════════════════
async function seedUsuarios(conn) {
  const [rows] = await conn.query('SELECT COUNT(*) as c FROM usuarios');
  if (rows[0].c > 0) return;

  const usuarios = [
    { nome:'admin',  senha:'admin123',  perfil:'ambos', is_admin:1 },
    { nome:'Pedro',  senha:'pedro123',  perfil:'alto',  is_admin:0 },
    { nome:'Diogo',  senha:'diogo123',  perfil:'alto',  is_admin:0 },
    { nome:'Albert', senha:'albert123', perfil:'alto',  is_admin:0 },
    { nome:'Arella', senha:'arella123', perfil:'alto',  is_admin:0 },
    { nome:'Victor', senha:'victor123', perfil:'baixo', is_admin:0 },
  ];

  for (const u of usuarios) {
    const hash = bcrypt.hashSync(u.senha, 10);
    await conn.query(
      'INSERT INTO usuarios (nome, senha_hash, perfil, is_admin) VALUES (?,?,?,?)',
      [u.nome, hash, u.perfil, u.is_admin]
    );
  }
  console.log('✓ Usuários padrão criados');
}

// ═══════════════════════════════════════════
//  SEED TAXAS
// ═══════════════════════════════════════════
async function seedCustos(conn) {
  const [rows] = await conn.query('SELECT COUNT(*) as c FROM custos');
  if (rows[0].c > 0) return;

  const stone = [
    {label:'Débito', vm:0.74, ea:0},
    {label:'1x',     vm:2.99, ea:3.14},
    {label:'2x',     vm:3.89, ea:4.03},
    {label:'3x',     vm:4.48, ea:4.63},
    {label:'4x',     vm:5.07, ea:5.21},
    {label:'5x',     vm:5.65, ea:5.80},
    {label:'6x',     vm:6.24, ea:6.36},
    {label:'7x',     vm:7.05, ea:7.47},
    {label:'8x',     vm:7.63, ea:8.05},
    {label:'9x',     vm:8.22, ea:8.64},
    {label:'10x',    vm:8.80, ea:9.22},
    {label:'11x',    vm:9.39, ea:9.80},
    {label:'12x',    vm:9.98, ea:10.38},
  ];
  const pagseguro = [
    {label:'Débito', vm:0.99, ea:0},
    {label:'1x',     vm:2.99, ea:3.69},
    {label:'2x',     vm:3.83, ea:4.87},
    {label:'3x',     vm:4.48, ea:5.52},
    {label:'4x',     vm:5.12, ea:6.16},
    {label:'5x',     vm:5.76, ea:6.80},
    {label:'6x',     vm:6.39, ea:7.43},
    {label:'7x',     vm:7.21, ea:8.84},
    {label:'8x',     vm:7.83, ea:9.46},
    {label:'9x',     vm:8.44, ea:10.07},
    {label:'10x',    vm:9.05, ea:10.68},
    {label:'11x',    vm:9.65, ea:11.29},
    {label:'12x',    vm:10.25,ea:11.88},
  ];

  for (const t of stone)
    await conn.query('INSERT IGNORE INTO custos (maquina,label,vm,ea) VALUES (?,?,?,?)', ['stone', t.label, t.vm, t.ea]);
  for (const t of pagseguro)
    await conn.query('INSERT IGNORE INTO custos (maquina,label,vm,ea) VALUES (?,?,?,?)', ['pagseguro', t.label, t.vm, t.ea]);

  console.log('✓ Custos padrão criados');
}

async function seedTaxas(conn) {
  const [rows] = await conn.query('SELECT COUNT(*) as c FROM taxas');
  if (rows[0].c > 0) return;

  const taxasBaixo = [
    {label:'Débito', vm:2.40, ea:2.49},
    {label:'1x',     vm:4.99, ea:5.47},
    {label:'2x',     vm:5.89, ea:6.07},
    {label:'3x',     vm:7.48, ea:7.64},
    {label:'4x',     vm:8.07, ea:8.22},
    {label:'5x',     vm:9.65, ea:9.81},
    {label:'6x',     vm:11.24,ea:11.39},
    {label:'7x',     vm:12.05,ea:12.47},
    {label:'8x',     vm:12.63,ea:13.06},
    {label:'9x',     vm:13.22,ea:13.68},
    {label:'10x',    vm:14.11,ea:14.76},
    {label:'11x',    vm:14.46,ea:15.02},
    {label:'12x',    vm:15.35,ea:16.96},
  ];
  const taxasAlto = [
    {label:'Débito', vm:2.40, ea:2.39},
    {label:'1x',     vm:3.99, ea:4.47},
    {label:'2x',     vm:4.89, ea:5.07},
    {label:'3x',     vm:5.48, ea:5.64},
    {label:'4x',     vm:6.07, ea:6.22},
    {label:'5x',     vm:6.65, ea:6.81},
    {label:'6x',     vm:7.24, ea:7.39},
    {label:'7x',     vm:8.05, ea:8.47},
    {label:'8x',     vm:8.63, ea:9.06},
    {label:'9x',     vm:9.22, ea:9.68},
    {label:'10x',    vm:10.11,ea:10.76},
    {label:'11x',    vm:10.46,ea:11.02},
    {label:'12x',    vm:11.35,ea:11.96},
  ];

  for (const t of taxasBaixo)
    await conn.query('INSERT IGNORE INTO taxas (perfil,label,vm,ea) VALUES (?,?,?,?)', ['baixo',t.label,t.vm,t.ea]);
  for (const t of taxasAlto)
    await conn.query('INSERT IGNORE INTO taxas (perfil,label,vm,ea) VALUES (?,?,?,?)', ['alto',t.label,t.vm,t.ea]);

  console.log('✓ Taxas padrão criadas');
}

// ═══════════════════════════════════════════
//  AUTH MIDDLEWARE
// ═══════════════════════════════════════════
function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ error: 'Token não fornecido' });
  try {
    req.user = jwt.verify(header.replace('Bearer ', ''), SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

function adminOnly(req, res, next) {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Acesso negado' });
  next();
}

// ═══════════════════════════════════════════
//  ROTAS — LOGIN
// ═══════════════════════════════════════════
app.post('/api/login', async (req, res) => {
  try {
    const { nome, senha } = req.body;
    const [rows] = await pool.query(
      'SELECT * FROM usuarios WHERE LOWER(nome) = LOWER(?)', [nome.trim()]
    );
    if (!rows.length) return res.status(401).json({ error: 'Usuário ou senha incorretos' });
    const user = rows[0];
    if (!bcrypt.compareSync(senha, user.senha_hash))
      return res.status(401).json({ error: 'Usuário ou senha incorretos' });

    const token = jwt.sign(
      { id: user.id, nome: user.nome, perfil: user.perfil, is_admin: user.is_admin },
      SECRET
      // sem expiração = fica logado para sempre
    );
    res.json({ token, user: { id:user.id, nome:user.nome, perfil:user.perfil, is_admin:user.is_admin } });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, nome, perfil, is_admin, maquina_modelo, maquina_serie, maquina_tipo FROM usuarios WHERE id = ?',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════
//  ROTAS — TAXAS
// ═══════════════════════════════════════════
app.get('/api/taxas/:perfil', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT label, vm, ea FROM taxas WHERE perfil = ? ORDER BY id', [req.params.perfil]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/taxas/:perfil', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { taxas } = req.body;
    for (const t of taxas)
      await pool.query(
        'UPDATE taxas SET vm=?, ea=? WHERE perfil=? AND label=?',
        [t.vm, t.ea, req.params.perfil, t.label]
      );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════
//  ROTAS — USUÁRIOS
// ═══════════════════════════════════════════
app.get('/api/usuarios', authMiddleware, adminOnly, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT u.id, u.nome, u.perfil, u.is_admin, u.maquina_modelo, u.maquina_serie, u.maquina_tipo,
             COUNT(v.id)                    as qtd_vendas,
             COALESCE(SUM(v.valor_bruto),0) as total_vendas,
             COALESCE(SUM(v.liquido),0)     as total_lucro,
             COALESCE(SUM(v.desconto),0)    as total_taxas
      FROM usuarios u
      LEFT JOIN vendas v ON v.usuario_id = u.id
      GROUP BY u.id ORDER BY u.id
    `);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/usuarios', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { nome, senha, perfil, maquina_modelo, maquina_serie, maquina_tipo } = req.body;
    if (!nome || !senha) return res.status(400).json({ error: 'Nome e senha obrigatórios' });
    const hash = bcrypt.hashSync(senha, 10);
    const [r] = await pool.query(
      'INSERT INTO usuarios (nome, senha_hash, perfil, is_admin, maquina_modelo, maquina_serie, maquina_tipo) VALUES (?,?,?,0,?,?,?)',
      [nome.trim(), hash, perfil||'baixo', maquina_modelo||'', maquina_serie||'', maquina_tipo||'stone']
    );
    res.json({ id: r.insertId, nome: nome.trim() });
  } catch(e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Usuário já existe' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/usuarios/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { nome, senha, perfil, maquina_modelo, maquina_serie, maquina_tipo } = req.body;
    const [rows] = await pool.query('SELECT * FROM usuarios WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
    const u = rows[0];
    const newHash = senha ? bcrypt.hashSync(senha, 10) : u.senha_hash;
    await pool.query(
      'UPDATE usuarios SET nome=?, senha_hash=?, perfil=?, maquina_modelo=?, maquina_serie=?, maquina_tipo=? WHERE id=?',
      [nome||u.nome, newHash, perfil||u.perfil, maquina_modelo??u.maquina_modelo, maquina_serie??u.maquina_serie, maquina_tipo??u.maquina_tipo, req.params.id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/usuarios/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM usuarios WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
    if (rows[0].is_admin) return res.status(403).json({ error: 'Não é possível excluir o admin' });
    await pool.query('DELETE FROM vendas   WHERE usuario_id=?', [req.params.id]);
    await pool.query('DELETE FROM usuarios WHERE id=?',         [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════
//  ROTAS — VENDAS
// ═══════════════════════════════════════════
function wherePeriodo(periodo, alias='v') {
  const col = `${alias}.criado_em`;
  // Calcula datas no Node.js no fuso de Brasília (UTC-3)
  const agora = new Date();
  const offsetBR = -3 * 60; // UTC-3 em minutos
  const agoraBR = new Date(agora.getTime() + (offsetBR - agora.getTimezoneOffset()) * 60000);

  const pad = n => String(n).padStart(2,'0');
  const hoje = `${agoraBR.getFullYear()}-${pad(agoraBR.getMonth()+1)}-${pad(agoraBR.getDate())}`;
  const ano  = agoraBR.getFullYear();
  const mes  = pad(agoraBR.getMonth()+1);

  // Início da semana = domingo (dia da semana 0)
  const diaSemana = agoraBR.getDay(); // 0=domingo, 1=segunda...
  const iniciSemana = new Date(agoraBR);
  iniciSemana.setDate(agoraBR.getDate() - diaSemana);
  const semanaIni = `${iniciSemana.getFullYear()}-${pad(iniciSemana.getMonth()+1)}-${pad(iniciSemana.getDate())}`;

  // Compara datas convertendo a coluna para Brasília
  const colBR = `CONVERT_TZ(${col}, '+00:00', '-03:00')`;

  if (periodo === 'hoje') {
    return `AND DATE(${colBR}) = '${hoje}'`;
  }
  if (periodo === 'semana') {
    return `AND DATE(${colBR}) >= '${semanaIni}'`;
  }
  if (periodo === 'mes') {
    return `AND DATE_FORMAT(${colBR}, '%Y-%m') = '${ano}-${mes}'`;
  }
  return '';
}

app.post('/api/vendas', authMiddleware, async (req, res) => {
  try {
    const { valor_bruto, taxa, desconto, liquido, parcela, bandeira, perfil, maquina_tipo } = req.body;
    // Busca maquina_tipo do usuario se nao vier no body
    const [uRows] = await pool.query('SELECT maquina_tipo FROM usuarios WHERE id=?', [req.user.id]);
    const maqTipoFinal = maquina_tipo || (uRows[0]?.maquina_tipo) || 'stone';
    const [r] = await pool.query(
      'INSERT INTO vendas (usuario_id,valor_bruto,taxa,desconto,liquido,parcela,bandeira,perfil,maquina_tipo) VALUES (?,?,?,?,?,?,?,?,?)',
      [req.user.id, valor_bruto, taxa, desconto, liquido, parcela, bandeira, perfil, maqTipoFinal]
    );
    res.json({ id: r.insertId, ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/vendas', authMiddleware, adminOnly, async (req, res) => {
  try {
    const w = wherePeriodo(req.query.periodo);
    const [rows] = await pool.query(`
      SELECT v.*, u.nome as usuario_nome
      FROM vendas v JOIN usuarios u ON u.id = v.usuario_id
      WHERE 1=1 ${w} ORDER BY v.criado_em DESC
    `);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/vendas/resumo', authMiddleware, adminOnly, async (req, res) => {
  try {
    const w = wherePeriodo(req.query.periodo);
    // Move o filtro de periodo para dentro do JOIN para nao quebrar o LEFT JOIN
    const [rows] = await pool.query(`
      SELECT u.id, u.nome, u.maquina_modelo, u.maquina_serie, u.maquina_tipo,
             COUNT(v.id)                    as qtd,
             COALESCE(SUM(v.valor_bruto),0) as total_bruto,
             COALESCE(SUM(v.liquido),0)     as total_lucro,
             COALESCE(SUM(v.desconto),0)    as total_taxas,
             MAX(v.criado_em)               as ultima_venda
      FROM usuarios u
      LEFT JOIN vendas v ON v.usuario_id = u.id AND 1=1 ${w}
      GROUP BY u.id, u.nome, u.maquina_modelo, u.maquina_serie, u.maquina_tipo
      ORDER BY u.nome
    `);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/vendas/usuario/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const w = wherePeriodo(req.query.periodo, '');
    await pool.query(
      `DELETE FROM vendas WHERE usuario_id=? ${w.replace(/v\./g,'')}`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/vendas/admin — admin registra venda para outro usuário
app.post('/api/vendas/admin', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { usuario_id, valor_bruto, taxa, desconto, liquido, parcela, bandeira, perfil, maquina_tipo } = req.body;
    if (!usuario_id || !valor_bruto) return res.status(400).json({ error: 'Dados inválidos' });
    const [r] = await pool.query(
      'INSERT INTO vendas (usuario_id,valor_bruto,taxa,desconto,liquido,parcela,bandeira,perfil,maquina_tipo) VALUES (?,?,?,?,?,?,?,?,?)',
      [usuario_id, valor_bruto, taxa, desconto, liquido, parcela, bandeira, perfil || 'alto', maquina_tipo || 'stone']
    );
    res.json({ id: r.insertId, ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/vendas/minha — vendas do usuário logado
app.get('/api/vendas/minha', authMiddleware, async (req, res) => {
  try {
    const w = wherePeriodo(req.query.periodo);
    const colBR = `CONVERT_TZ(v.criado_em, '+00:00', '-03:00')`;
    const [rows] = await pool.query(`
      SELECT * FROM vendas v
      WHERE usuario_id = ? ${w}
      ORDER BY v.criado_em DESC
    `, [req.user.id]);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/vendas/:id — excluir venda individual
// Admin pode excluir qualquer venda; usuário só pode excluir as próprias
app.delete('/api/vendas/:id', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM vendas WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Venda não encontrada' });
    // Verifica permissão: admin pode tudo, usuário só exclui as próprias
    if (!req.user.is_admin && rows[0].usuario_id !== req.user.id) {
      return res.status(403).json({ error: 'Sem permissão para excluir esta venda' });
    }
    await pool.query('DELETE FROM vendas WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});



// GET /api/custos/:maquina
app.get('/api/custos/:maquina', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT label, vm, ea FROM custos WHERE maquina = ? ORDER BY id',
      [req.params.maquina]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/custos/:maquina (admin only)
app.put('/api/custos/:maquina', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { custos } = req.body;
    if (!Array.isArray(custos)) return res.status(400).json({ error: 'Dados inválidos' });
    for (const t of custos) {
      await pool.query(
        'UPDATE custos SET vm=?, ea=? WHERE maquina=? AND label=?',
        [t.vm, t.ea, req.params.maquina, t.label]
      );
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Catch-all → frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ═══════════════════════════════════════════
//  START
// ═══════════════════════════════════════════
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 LAB rodando em http://localhost:${PORT}`);
    console.log(`🗄️  Banco: MySQL (XAMPP)`);
    console.log(`\nAcesse: http://localhost\n`);
  });
}).catch(err => {
  console.error('\n❌ Erro ao conectar no MySQL:', err.message);
  console.error('Verifique se o MySQL do XAMPP está rodando!\n');
  process.exit(1);
});
