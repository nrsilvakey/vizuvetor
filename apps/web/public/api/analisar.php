<?php
// VizuVetor — intermediário para a análise de elementos por IA (Claude, API da Anthropic).
// A chave fica em config.php no servidor; nunca vai para o navegador.
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

function falha($code, $msg) { http_response_code($code); echo json_encode(['erro' => $msg], JSON_UNESCAPED_UNICODE); exit; }

// config fora da pasta pública: domains/<domínio>/vizuvetor-config.php (fallback: config.php ao lado)
$cfgFile = null;
foreach ([dirname(__DIR__, 4) . '/vizuvetor-config.php', dirname(__DIR__, 3) . '/vizuvetor-config.php', __DIR__ . '/config.php'] as $c) { if (is_file($c)) { $cfgFile = $c; break; } }
if (!$cfgFile) falha(503, 'Análise por IA não configurada no servidor.');
$cfg = require $cfgFile;
$key = trim($cfg['anthropic_key'] ?? '');
if ($key === '' || strpos($key, 'COLE_') === 0) falha(503, 'Chave da API ainda não foi colada em config.php.');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') falha(405, 'Use POST.');

// senha de equipe (opcional)
$senha = $cfg['senha_equipe'] ?? '';
if ($senha !== '' && !hash_equals($senha, $_SERVER['HTTP_X_VV_SENHA'] ?? '')) falha(401, 'Senha da equipe incorreta.');

// limite por IP por hora
$lim = intval($cfg['limite_por_hora'] ?? 60);
$ip = $_SERVER['REMOTE_ADDR'] ?? 'x';
$f = sys_get_temp_dir() . '/vv_rl_' . md5($ip . date('YmdH'));
$n = is_file($f) ? intval(file_get_contents($f)) : 0;
if ($n >= $lim) falha(429, 'Limite de análises por hora atingido. Tente mais tarde.');
file_put_contents($f, strval($n + 1));

$raw = file_get_contents('php://input', false, null, 0, 12 * 1024 * 1024);
$in = json_decode($raw, true);
if (!is_array($in) || empty($in['imagem'])) falha(400, 'Envie a imagem em base64.');
$tipo = in_array($in['tipo_midia'] ?? '', ['image/jpeg', 'image/png', 'image/webp']) ? $in['tipo_midia'] : 'image/jpeg';
$img = preg_replace('/[^A-Za-z0-9+\/=]/', '', $in['imagem']);
if (strlen($img) > 10 * 1024 * 1024) falha(413, 'Imagem grande demais.');
$contexto = mb_substr(strval($in['contexto'] ?? ''), 0, 400);

$schema = [
  'type' => 'object',
  'properties' => [
    'tipo_de_arte' => ['type' => 'string', 'enum' => ['uniforme', 'ilustracao', 'chapada']],
    'cor_base' => ['type' => 'string', 'description' => 'cor dominante do tecido/fundo em #RRGGBB'],
    'elementos' => ['type' => 'array', 'items' => [
      'type' => 'object',
      'properties' => [
        'tipo' => ['type' => 'string', 'enum' => ['texto', 'numero', 'logo', 'escudo', 'listra', 'faixa', 'personagem', 'ilustracao', 'ornamento', 'padrao', 'fundo', 'marca_terceiros', 'etiqueta_mockup', 'cenario_mockup']],
        'rotulo' => ['type' => 'string', 'description' => 'nome curto em português'],
        'caixa' => ['type' => 'array', 'items' => ['type' => 'number'], 'minItems' => 4, 'maxItems' => 4, 'description' => '[x0,y0,x1,y1] em milésimos da largura/altura da imagem (0 a 1000)'],
        'texto' => ['type' => 'string', 'description' => 'conteúdo exato com acentos, só para texto/numero'],
        'estilo_fonte' => ['type' => 'string', 'description' => 'ex.: sem serifa condensada pesada, serifa grossa, cursiva'],
        'cor' => ['type' => 'string', 'description' => 'cor principal #RRGGBB'],
        'contorno' => ['type' => 'string', 'description' => 'cor do contorno/filete #RRGGBB ou vazio'],
        'tratamento' => ['type' => 'string', 'enum' => ['texto_vivo', 'vetor', 'bitmap_recortado', 'fundo', 'descartar']],
        'confianca' => ['type' => 'number'],
      ],
      'required' => ['tipo', 'rotulo', 'caixa', 'tratamento', 'confianca'],
    ]],
  ],
  'required' => ['tipo_de_arte', 'elementos'],
];

$instrucoes = "Você analisa artes de camisetas/uniformes/placas para pré-impressão numa gráfica (CorelDRAW). "
 . "Liste TODOS os elementos visuais separadamente, cada um com caixa justa. Regras de tratamento: "
 . "texto e números -> texto_vivo (transcreva exatamente, com acentos); logos, escudos, coroas, listras, faixas e ornamentos chapados -> vetor; "
 . "personagens, fotos, paisagens e letreiros com efeito 3D/dourado complexo -> bitmap_recortado; "
 . "o tecido/fundo da peça -> fundo; estádio, gramado, manequim, etiquetas e textos de apresentação do mockup -> descartar; "
 . "logos de fabricantes de material esportivo ou marcas de terceiros -> tipo marca_terceiros, tratamento descartar. "
 . "Não junte elementos diferentes numa caixa só (ex.: escudo e texto abaixo dele são elementos separados). "
 . "Contexto: " . $contexto;

$body = [
  'model' => $cfg['modelo'] ?? 'claude-sonnet-5-5',
  'max_tokens' => 4096,
  'tools' => [[ 'name' => 'registrar_elementos', 'description' => 'Registra os elementos encontrados na arte.', 'input_schema' => $schema ]],
  'tool_choice' => ['type' => 'tool', 'name' => 'registrar_elementos'],
  'messages' => [[ 'role' => 'user', 'content' => [
    ['type' => 'image', 'source' => ['type' => 'base64', 'media_type' => $tipo, 'data' => $img]],
    ['type' => 'text', 'text' => $instrucoes],
  ]]],
];

$ch = curl_init('https://api.anthropic.com/v1/messages');
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_TIMEOUT => 120,
  CURLOPT_HTTPHEADER => ['content-type: application/json', 'x-api-key: ' . $key, 'anthropic-version: 2023-06-01'],
  CURLOPT_POSTFIELDS => json_encode($body, JSON_UNESCAPED_UNICODE),
]);
$resp = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err = curl_error($ch);
curl_close($ch);
if ($resp === false) falha(502, 'Sem conexão com a API: ' . $err);
$j = json_decode($resp, true);
if ($code !== 200) falha($code >= 500 ? 502 : $code, 'API: ' . ($j['error']['message'] ?? ('HTTP ' . $code)));
foreach (($j['content'] ?? []) as $b) {
  if (($b['type'] ?? '') === 'tool_use') {
    echo json_encode(['ok' => true, 'resultado' => $b['input'], 'uso' => $j['usage'] ?? null, 'modelo' => $j['model'] ?? null], JSON_UNESCAPED_UNICODE);
    exit;
  }
}
falha(502, 'A IA não devolveu a lista de elementos.');
