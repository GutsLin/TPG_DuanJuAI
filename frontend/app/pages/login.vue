<template>
  <div class="login-page">
    <section class="login-panel card">
      <div class="brand-row">
        <img :src="brandLogo" alt="调皮狗短剧" class="brand-logo" />
        <div>
          <div class="brand-name">调皮狗短剧</div>
          <div class="brand-sub">TPG Shorts</div>
        </div>
      </div>

      <div class="login-head">
        <h1>{{ mode === 'login' ? '登录工作台' : '创建账号' }}</h1>
        <p>{{ mode === 'login' ? '继续管理你的短剧项目' : '第一位注册用户会自动成为管理员' }}</p>
      </div>

      <form class="login-form" @submit.prevent="submit">
        <label v-if="mode === 'register'" class="field">
          <span class="field-label">昵称</span>
          <input v-model="form.name" class="input" placeholder="例如：调皮狗导演" />
        </label>
        <label class="field">
          <span class="field-label">邮箱</span>
          <input v-model="form.email" class="input" type="email" autocomplete="email" required />
        </label>
        <label class="field">
          <span class="field-label">密码</span>
          <input v-model="form.password" class="input" type="password" autocomplete="current-password" minlength="8" required />
        </label>
        <button class="btn btn-primary login-submit" type="submit" :disabled="submitting">
          {{ submitting ? '处理中...' : (mode === 'login' ? '登录' : '注册并进入') }}
        </button>
      </form>

      <button class="mode-switch" type="button" @click="mode = mode === 'login' ? 'register' : 'login'">
        {{ mode === 'login' ? '还没有账号？注册' : '已有账号？登录' }}
      </button>
    </section>
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import brandLogo from '~/assets/huobao-logo.png'
import { useAuth } from '~/composables/useAuth'

definePageMeta({ layout: false })

const { login, register } = useAuth()
const mode = ref('login')
const submitting = ref(false)
const form = reactive({ email: '', password: '', name: '' })

async function submit() {
  submitting.value = true
  try {
    if (mode.value === 'login') await login(form.email, form.password)
    else await register(form.email, form.password, form.name)
    await navigateTo('/')
  } catch (e) {
    toast.error(e.message)
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--bg-base);
}
.login-panel {
  width: min(420px, 100%);
  padding: 30px;
  display: flex;
  flex-direction: column;
  gap: 22px;
  box-shadow: var(--shadow-elevated);
}
.brand-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.brand-logo {
  width: 36px;
  height: 36px;
  object-fit: contain;
}
.brand-name {
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 700;
}
.brand-sub {
  font-size: 11px;
  color: var(--text-3);
  letter-spacing: 0.04em;
}
.login-head h1 {
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 700;
}
.login-head p {
  margin-top: 6px;
  font-size: 13px;
  color: var(--text-3);
}
.login-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-1);
}
.login-submit {
  justify-content: center;
  margin-top: 4px;
}
.mode-switch {
  align-self: center;
  border: none;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  font-size: 13px;
}
</style>
