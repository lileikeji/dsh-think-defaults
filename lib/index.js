'use strict'
/**
 * dsh-think-defaults — 自动补全模型思考等级（reasoning efforts）
 *
 * 扫描 settings 的 llm-pi-ai.providers 下所有模型：
 *  - 缺 reasoningEfforts  → 补默认档位（off/high/max）
 *  - 缺 compat            → 补 thinkingFormat: deepseek + supportsReasoningEffort: false
 *  - 缺 maxTokens         → 补默认值（384000）
 *
 * 触发时机：
 *  - 启动后延迟扫描（等 settings 注册）
 *  - 轮询兜底（20s）：settings/updated 事件在热重载/插件顺序下可能不可达，
 *    定期扫描保证任何新增模型最终都被补全（幂等，无变化不写回）。
 *
 * 服务访问用 ctx.get('settings')（全局服务存储，拓扑无关），不依赖注入属性。
 * 状态端点 /dsh-think-defaults/status 暴露最近扫描结果（诊断用）。
 */
const name = 'dsh-think-defaults'
const inject = ['settings', 'webServer']

function log(ctx, level, msg) {
  try { ctx.logger[level](`[think-defaults] ${msg}`) } catch { /* noop */ }
}

/**
 * 视觉模型识别：模型 id/name 含这些特征视为支持图像输入。
 * 保守优先——只标确定支持视觉的系列，避免给纯文本模型误标。
 */
const VISION_RE = /(?:^|\/|-)(?:vl|vision|4v|4\.5v|mimo|internvl|minicpm)(?:$|[^a-z0-9]|[-.]|_)|kimi|qwen3\.7|qwen3\.8|seed-2\.1/i

/** 该模型是否应标注为视觉模型（input 含 image）。 */
function isVisionModel(model) {
  if (!model || typeof model !== 'object') return false
  const id = String(model.id || '')
  const name = String(model.name || '')
  return VISION_RE.test(id) || VISION_RE.test(name)
}

function apply(ctx, config) {
  const cfg = config || {}
  if (cfg.enabled === false) {
    log(ctx, 'info', 'disabled by config, skipping')
    return
  }
  const defaultEfforts = cfg.defaultReasoningEfforts || { off: null, high: 'high', max: 'max' }
  const defaultCompat = cfg.defaultCompat || { thinkingFormat: 'deepseek', supportsReasoningEffort: false }
  const defaultMaxTokens = cfg.defaultMaxTokens || 384000
  const status = { lastScan: null, patched: 0, providersSeen: 0, lastError: null }

  function patchModel(model) {
    if (!model || typeof model !== 'object') return false
    let changed = false
    if (model.reasoningEfforts === undefined || model.reasoningEfforts === null) {
      model.reasoningEfforts = { ...defaultEfforts }
      changed = true
    }
    if (model.compat === undefined || model.compat === null) {
      model.compat = { ...defaultCompat }
      changed = true
    }
    if (model.maxTokens === undefined || model.maxTokens === null) {
      model.maxTokens = defaultMaxTokens
      changed = true
    }
    // 视觉模型自动标注：识别到视觉特征且未声明 image 时补上
    if (isVisionModel(model)) {
      const input = Array.isArray(model.input) ? model.input : []
      if (!input.includes('image')) {
        model.input = [...new Set([...input, 'text', 'image'])]
        changed = true
      }
    }
    return changed
  }

  function runScan() {
    try {
      const settingsSvc = ctx.get('settings')
      if (!settingsSvc || typeof settingsSvc.get !== 'function') {
        status.lastError = 'settings service unavailable'
        status.lastScan = new Date().toISOString()
        log(ctx, 'warn', 'settings service unavailable via ctx.get')
        return
      }
      const current = settingsSvc.get('llm-pi-ai') || {}
      const providers = current.providers
      status.providersSeen = providers && typeof providers === 'object' ? Object.keys(providers).length : 0
      if (!providers || typeof providers !== 'object') {
        status.lastScan = new Date().toISOString()
        status.lastError = null
        log(ctx, 'info', 'no llm-pi-ai.providers found')
        return
      }
      const next = JSON.parse(JSON.stringify({ providers }))
      const patched = (() => {
        let n = 0
        for (const [pname, pconf] of Object.entries(next.providers)) {
          if (!pconf || typeof pconf !== 'object' || !Array.isArray(pconf.models)) continue
          for (const model of pconf.models) {
            if (patchModel(model)) {
              log(ctx, 'info', `patched thinking defaults for ${pname}/${model.id}`)
              n += 1
            }
          }
        }
        return n
      })()
      status.lastScan = new Date().toISOString()
      status.lastError = null
      if (patched > 0) {
        settingsSvc.update('llm-pi-ai', { providers: next.providers }).then(() => {
          status.patched += patched
          log(ctx, 'info', `patched ${patched} model(s), settings updated`)
        }).catch((e) => {
          status.lastError = `update failed: ${e.message}`
          log(ctx, 'warn', `settings update failed: ${e.message}`)
        })
      }
    } catch (e) {
      status.lastError = e.message
      status.lastScan = new Date().toISOString()
      log(ctx, 'warn', `scan failed: ${e.message}`)
    }
  }

  // 启动后延迟扫描 + 轮询兜底
  const bootTimer = setTimeout(runScan, 1500)
  const pollTimer = setInterval(runScan, 20000)

  // 状态端点（诊断用）
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-think-defaults/status',
    handler: (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(status))
    },
  }), 'dsh-think-defaults: status route')

  ctx.effect(() => () => {
    clearTimeout(bootTimer)
    clearInterval(pollTimer)
  }, 'dsh-think-defaults: timers')
}

module.exports = { name, inject, apply }
