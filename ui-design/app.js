const toast = document.querySelector("#toast")
let toastTimer

function showToast(message) {
  toast.textContent = message
  toast.classList.add("visible")
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2400)
}

document.querySelector("#chat-form").addEventListener("submit", (event) => {
  event.preventDefault()
  const input = document.querySelector("#chat-input")
  const text = input.value.trim()
  if (!text) {
    input.focus()
    return
  }

  const message = document.createElement("article")
  message.className = "message own-message"

  const avatar = document.createElement("span")
  avatar.className = "message-avatar avatar-you"
  avatar.textContent = "JD"

  const body = document.createElement("div")
  body.className = "message-body"

  const meta = document.createElement("div")
  meta.className = "message-meta"

  const name = document.createElement("strong")
  name.textContent = "You"

  const time = document.createElement("time")
  time.textContent = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date())

  const content = document.createElement("p")
  content.textContent = text

  meta.append(name, time)
  body.append(meta, content)
  message.append(avatar, body)

  const list = document.querySelector("#message-list")
  list.append(message)
  list.scrollTop = list.scrollHeight
  input.value = ""
})

document.querySelector("#chat-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault()
    document.querySelector("#chat-form").requestSubmit()
  }
})

document.querySelector("#run-button").addEventListener("click", () => {
  showToast("Preview is ready to run when connected to a project.")
})

document.querySelector("#share-button").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(window.location.href)
    showToast("Concept link copied to clipboard.")
  } catch {
    showToast("Project sharing will be available in the connected app.")
  }
})

document.querySelectorAll(".file-tab[data-file]").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".file-tab[data-file]").forEach((fileTab) => {
      const active = fileTab === tab
      fileTab.classList.toggle("active", active)
      fileTab.setAttribute("aria-selected", String(active))
    })

    const file = tab.dataset.file
    document.querySelector(".file-path strong").textContent = file
    showToast(`${file} selected in the concept editor.`)
  })
})

document.querySelectorAll(".rail-link, .project-link, .subtle-button, .activity-action, .workspace-switcher, .help-link").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.matches(".rail-link.active, .project-link.selected")) return
    const label = button.textContent.trim().replace(/\s+/g, " ")
    if (label) showToast(`${label} is a preview-only control.`)
  })
})
