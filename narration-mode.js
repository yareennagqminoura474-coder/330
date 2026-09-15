(function () {
  'use strict';

  function initNarrationMode() {
    const button = document.getElementById('narration-mode-btn');
    const input = document.getElementById('chat-input');
    const sendButton = document.getElementById('send-btn');
    const inputArea = document.getElementById('chat-input-area');
    const messages = document.getElementById('chat-messages');
    const chatTitle = document.getElementById('chat-header-title');
    const backButton = document.getElementById('back-to-list-btn');

    if (!button || !input || !sendButton || !inputArea || !messages) return;

    let sendAsNarration = false;
    const normalPlaceholder = input.getAttribute('placeholder') || '输入消息...';

    function setNarrationMode(enabled) {
      sendAsNarration = Boolean(enabled);
      button.classList.toggle('active', sendAsNarration);
      button.setAttribute('aria-pressed', String(sendAsNarration));
      button.setAttribute('aria-label', sendAsNarration ? '关闭旁白' : '旁白模式');
      button.title = sendAsNarration ? '关闭旁白' : '旁白模式';
      inputArea.classList.toggle('narration-mode-active', sendAsNarration);
      input.placeholder = sendAsNarration ? '输入旁白...' : normalPlaceholder;
    }

    function markNarrationBubbles(root) {
      const scope = root && root.querySelectorAll ? root : messages;
      const spans = scope.querySelectorAll(
        '.message-wrapper.system-pat .message-bubble.system-bubble > span[style*="font-style"]',
      );

      spans.forEach((span) => {
        const bubble = span.parentElement;
        const wrapper = bubble && bubble.parentElement;
        if (!bubble || !wrapper || !/italic/i.test(span.getAttribute('style') || '')) return;
        bubble.classList.add('narration-bubble');
        wrapper.classList.add('narration-wrapper');
      });
    }

    button.addEventListener('click', function () {
      setNarrationMode(!sendAsNarration);
      input.focus();
    });

    // EPhone 原有的 /n 发送路径负责落库、历史兼容和私聊/群聊共用逻辑。
    // 捕获阶段仅把当前输入标记成旁白，再交回原发送处理器。
    sendButton.addEventListener(
      'click',
      function () {
        const text = input.value.trim();
        if (!sendAsNarration || !text || /^(?:\/n|\/旁白)\s+/i.test(text)) return;
        input.value = '/n ' + text;
      },
      true,
    );

    button.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      button.click();
    });

    if (backButton) backButton.addEventListener('click', function () {
      setNarrationMode(false);
    });

    if (chatTitle) {
      let currentTitle = chatTitle.textContent;
      new MutationObserver(function () {
        if (chatTitle.textContent === currentTitle) return;
        currentTitle = chatTitle.textContent;
        setNarrationMode(false);
      }).observe(chatTitle, { childList: true, subtree: true, characterData: true });
    }

    markNarrationBubbles(messages);
    new MutationObserver(function (records) {
      records.forEach(function (record) {
        record.addedNodes.forEach(function (node) {
          if (node.nodeType === Node.ELEMENT_NODE) markNarrationBubbles(node);
        });
      });
    }).observe(messages, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNarrationMode, { once: true });
  } else {
    initNarrationMode();
  }
})();
