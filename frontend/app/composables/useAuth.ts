import { authAPI, setAuthToken, getAuthToken } from '~/composables/useApi'

export function useAuth() {
  const user = useState<any | null>('auth:user', () => null)
  const loading = useState('auth:loading', () => false)

  async function loadMe() {
    if (!getAuthToken()) {
      user.value = null
      return null
    }
    loading.value = true
    try {
      const res = await authAPI.me()
      user.value = res.user
      return user.value
    } catch {
      user.value = null
      return null
    } finally {
      loading.value = false
    }
  }

  async function login(email: string, password: string) {
    const res = await authAPI.login({ email, password })
    setAuthToken(res.token)
    user.value = res.user
    return res.user
  }

  async function register(email: string, password: string, name?: string) {
    const res = await authAPI.register({ email, password, name })
    setAuthToken(res.token)
    user.value = res.user
    return res.user
  }

  function logout() {
    setAuthToken('')
    user.value = null
    navigateTo('/login')
  }

  return { user, loading, loadMe, login, register, logout }
}
