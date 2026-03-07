(function attachUiVaporize(globalScope) {
  const SVG_NS = 'http://www.w3.org/2000/svg'
  const XLINK_NS = 'http://www.w3.org/1999/xlink'
  let overlayRoot = null

  function vaporizeElement(element, options = {}) {
    if (!(element instanceof Element)) {
      return Promise.resolve(false)
    }

    const rect = element.getBoundingClientRect()
    if (!rect.width || !rect.height) {
      return Promise.resolve(false)
    }

    const snapshot = createSnapshotClone(element)
    const particleOptions = {
      durationMs: clampNumber(options.durationMs, 520, 320, 760),
      particleSize: clampNumber(options.particleSize, getAdaptiveParticleSize(rect), 2, 8),
      travel: clampNumber(options.travel, Math.max(rect.width, rect.height) * 0.16, 12, 44),
      gravity: clampNumber(options.gravity, Math.max(rect.height * 0.12, 9), 6, 28),
      delayMs: clampNumber(options.delayMs, 0, 0, 240)
    }

    return renderSnapshotToCanvas(snapshot, rect)
      .catch(() => renderFallbackSnapshot(snapshot, rect))
      .then((canvas) => {
        if (!canvas) {
          return false
        }

        const overlayCanvas = buildOverlayCanvas(rect, particleOptions)
        const particleState = createParticleState(canvas, rect, particleOptions)

        if (!particleState.length) {
          overlayCanvas.remove()
          return false
        }

        return animateParticles(overlayCanvas, particleState, particleOptions).then(() => true)
      })
      .catch(() => false)
  }

  function createSnapshotClone(element) {
    const clone = cloneNodeWithInlineStyles(element)
    clone.style.margin = '0'
    clone.style.transform = 'none'
    clone.style.opacity = '1'
    clone.style.pointerEvents = 'none'
    clone.setAttribute('aria-hidden', 'true')
    return clone
  }

  function cloneNodeWithInlineStyles(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent || '')
    }

    if (!(node instanceof Element)) {
      return document.createDocumentFragment()
    }

    const clone = node.cloneNode(false)
    const computedStyle = window.getComputedStyle(node)

    clone.removeAttribute('id')
    clone.removeAttribute('hidden')
    clone.removeAttribute('aria-live')

    let cssText = ''
    for (const propertyName of computedStyle) {
      cssText += `${propertyName}:${computedStyle.getPropertyValue(propertyName)};`
    }
    clone.style.cssText = cssText

    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      clone.setAttribute('value', node.value)
      clone.textContent = node.value
    }

    for (const childNode of node.childNodes) {
      clone.appendChild(cloneNodeWithInlineStyles(childNode))
    }

    return clone
  }

  function renderSnapshotToCanvas(snapshot, rect) {
    const pixelRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2))
    const width = Math.max(1, Math.ceil(rect.width))
    const height = Math.max(1, Math.ceil(rect.height))
    const wrapper = document.createElement('div')

    wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
    wrapper.style.width = `${width}px`
    wrapper.style.height = `${height}px`
    wrapper.style.display = 'block'
    wrapper.style.overflow = 'visible'
    wrapper.appendChild(snapshot)

    const serialized = new XMLSerializer().serializeToString(wrapper)
    const svg = [
      `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      '<foreignObject width="100%" height="100%">',
      serialized,
      '</foreignObject>',
      '</svg>'
    ].join('')
    const image = new Image()
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)

    return new Promise((resolve, reject) => {
      image.onload = () => {
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')

        canvas.width = Math.ceil(width * pixelRatio)
        canvas.height = Math.ceil(height * pixelRatio)
        canvas.style.width = `${width}px`
        canvas.style.height = `${height}px`
        context.scale(pixelRatio, pixelRatio)
        context.drawImage(image, 0, 0, width, height)
        URL.revokeObjectURL(url)
        resolve(canvas)
      }

      image.onerror = (error) => {
        URL.revokeObjectURL(url)
        reject(error)
      }

      image.src = url
    })
  }

  function renderFallbackSnapshot(snapshot, rect) {
    const pixelRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2))
    const width = Math.max(1, Math.ceil(rect.width))
    const height = Math.max(1, Math.ceil(rect.height))
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    const bubbleStyle = window.getComputedStyle(snapshot)
    const radius = parseFloat(bubbleStyle.borderRadius) || 16

    canvas.width = Math.ceil(width * pixelRatio)
    canvas.height = Math.ceil(height * pixelRatio)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    context.scale(pixelRatio, pixelRatio)

    drawRoundedRect(context, 0, 0, width, height, radius)
    context.fillStyle = bubbleStyle.backgroundColor || 'rgba(12, 12, 12, 0.88)'
    context.fill()
    context.strokeStyle = bubbleStyle.borderColor || 'rgba(255, 255, 255, 0.14)'
    context.lineWidth = parseFloat(bubbleStyle.borderWidth) || 1
    context.stroke()

    const textNodes = Array.from(snapshot.querySelectorAll('*'))
      .map((node) => node.textContent || '')
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim()

    context.fillStyle = bubbleStyle.color || '#f3f3f3'
    context.font = `${bubbleStyle.fontWeight || '500'} ${bubbleStyle.fontSize || '12px'} ${bubbleStyle.fontFamily || 'sans-serif'}`
    context.textBaseline = 'top'
    drawWrappedText(context, textNodes, 14, 12, width - 28, 16)

    return Promise.resolve(canvas)
  }

  function buildOverlayCanvas(rect, options) {
    const margin = Math.ceil(options.travel + 18)
    const pixelRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2))
    const canvas = document.createElement('canvas')

    canvas.width = Math.ceil((rect.width + margin * 2) * pixelRatio)
    canvas.height = Math.ceil((rect.height + margin * 2) * pixelRatio)
    canvas.style.position = 'fixed'
    canvas.style.left = `${rect.left - margin}px`
    canvas.style.top = `${rect.top - margin}px`
    canvas.style.width = `${rect.width + margin * 2}px`
    canvas.style.height = `${rect.height + margin * 2}px`
    canvas.style.pointerEvents = 'none'
    canvas.style.zIndex = '9999'
    canvas.dataset.margin = String(margin)
    canvas.dataset.pixelRatio = String(pixelRatio)
    ensureOverlayRoot().appendChild(canvas)
    return canvas
  }

  function createParticleState(snapshotCanvas, rect, options) {
    const sourceContext = snapshotCanvas.getContext('2d', { willReadFrequently: true })
    const pixelRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2))
    const sourceWidth = Math.max(1, Math.ceil(rect.width * pixelRatio))
    const sourceHeight = Math.max(1, Math.ceil(rect.height * pixelRatio))
    const imageData = sourceContext.getImageData(0, 0, sourceWidth, sourceHeight)
    const step = Math.max(2, Math.round(options.particleSize * pixelRatio))
    const particles = []
    const centerX = rect.width / 2
    const centerY = rect.height / 2
    const margin = Number(options.travel + 18)

    for (let y = 0; y < sourceHeight; y += step) {
      for (let x = 0; x < sourceWidth; x += step) {
        const sample = samplePixelBlock(imageData, sourceWidth, sourceHeight, x, y, step)
        if (!sample || sample.alpha < 28) {
          continue
        }

        const worldX = x / pixelRatio
        const worldY = y / pixelRatio
        const offsetX = worldX - centerX
        const offsetY = worldY - centerY
        const distance = Math.hypot(offsetX, offsetY) || 1
        const directionX = offsetX / distance
        const directionY = offsetY / distance
        const driftX = directionX * (options.travel * (0.64 + Math.random() * 0.72))
        const driftY =
          directionY * (options.travel * 0.26) +
          options.gravity * (0.55 + Math.random() * 0.8) +
          (Math.random() - 0.5) * 6

        particles.push({
          x: worldX + margin,
          y: worldY + margin,
          size: Math.max(1.8, step / pixelRatio),
          color: `rgba(${sample.red}, ${sample.green}, ${sample.blue}, ${Math.max(sample.alpha / 255, 0.08)})`,
          driftX,
          driftY,
          rotation: (Math.random() - 0.5) * 0.55,
          life: 0.72 + Math.random() * 0.28
        })
      }
    }

    return particles
  }

  function samplePixelBlock(imageData, width, height, startX, startY, step) {
    let red = 0
    let green = 0
    let blue = 0
    let alpha = 0
    let count = 0

    for (let y = startY; y < Math.min(startY + step, height); y += 1) {
      for (let x = startX; x < Math.min(startX + step, width); x += 1) {
        const index = (y * width + x) * 4
        const pixelAlpha = imageData.data[index + 3]

        if (pixelAlpha < 10) {
          continue
        }

        red += imageData.data[index]
        green += imageData.data[index + 1]
        blue += imageData.data[index + 2]
        alpha += pixelAlpha
        count += 1
      }
    }

    if (!count) {
      return null
    }

    return {
      red: Math.round(red / count),
      green: Math.round(green / count),
      blue: Math.round(blue / count),
      alpha: Math.round(alpha / count)
    }
  }

  function animateParticles(canvas, particles, options) {
    const context = canvas.getContext('2d')
    const pixelRatio = Number(canvas.dataset.pixelRatio || 1)
    const margin = Number(canvas.dataset.margin || 0)
    const startAt = performance.now() + options.delayMs

    context.scale(pixelRatio, pixelRatio)

    return new Promise((resolve) => {
      function frame(now) {
        if (now < startAt) {
          requestAnimationFrame(frame)
          return
        }

        const elapsed = now - startAt
        const progress = Math.min(1, elapsed / options.durationMs)

        context.clearRect(
          0,
          0,
          canvas.width / pixelRatio,
          canvas.height / pixelRatio
        )

        for (const particle of particles) {
          const particleProgress = Math.min(1, progress / particle.life)
          const eased = easeOutCubic(particleProgress)
          const fade = Math.max(0, 1 - particleProgress)
          const x = particle.x + particle.driftX * eased
          const y = particle.y + particle.driftY * eased + particleProgress * particleProgress * 4
          const size = particle.size * (0.92 + fade * 0.26)

          context.save()
          context.translate(x, y)
          context.rotate(particle.rotation * eased)
          context.globalAlpha = fade * fade
          context.fillStyle = particle.color
          context.fillRect(0, 0, size, size)
          context.restore()
        }

        if (progress < 1) {
          requestAnimationFrame(frame)
          return
        }

        canvas.remove()
        resolve()
      }

      requestAnimationFrame(frame)
    })
  }

  function ensureOverlayRoot() {
    if (overlayRoot && overlayRoot.isConnected) {
      return overlayRoot
    }

    overlayRoot = document.createElement('div')
    overlayRoot.style.position = 'fixed'
    overlayRoot.style.inset = '0'
    overlayRoot.style.pointerEvents = 'none'
    overlayRoot.style.zIndex = '9999'
    document.body.appendChild(overlayRoot)
    return overlayRoot
  }

  function drawRoundedRect(context, x, y, width, height, radius) {
    const safeRadius = Math.min(radius, width / 2, height / 2)
    context.beginPath()
    context.moveTo(x + safeRadius, y)
    context.arcTo(x + width, y, x + width, y + height, safeRadius)
    context.arcTo(x + width, y + height, x, y + height, safeRadius)
    context.arcTo(x, y + height, x, y, safeRadius)
    context.arcTo(x, y, x + width, y, safeRadius)
    context.closePath()
  }

  function drawWrappedText(context, text, x, y, maxWidth, lineHeight) {
    const words = String(text || '').split(/\s+/).filter(Boolean)
    let line = ''
    let cursorY = y

    for (const word of words) {
      const nextLine = line ? `${line} ${word}` : word

      if (context.measureText(nextLine).width > maxWidth && line) {
        context.fillText(line, x, cursorY)
        line = word
        cursorY += lineHeight
        continue
      }

      line = nextLine
    }

    if (line) {
      context.fillText(line, x, cursorY)
    }
  }

  function getAdaptiveParticleSize(rect) {
    const area = rect.width * rect.height

    if (area <= 12000) {
      return 3
    }

    if (area <= 26000) {
      return 4
    }

    return 5
  }

  function easeOutCubic(value) {
    return 1 - Math.pow(1 - value, 3)
  }

  function clampNumber(value, fallback, min, max) {
    const numeric = Number.isFinite(value) ? value : fallback
    return Math.min(max, Math.max(min, numeric))
  }

  globalScope.WslVoiceTerminalVaporize = {
    vaporizeElement
  }
})(window)
