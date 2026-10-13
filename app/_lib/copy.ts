/**
 * User-facing copy of the web application (Latin American Spanish).
 *
 * All visible text lives here. To add another locale, add a second object with
 * the same shape (`typeof es`) and select it where `copy` is exported.
 */
const es = {
  common: {
    productName: "Parkline",
    tagline: "Gestión de flota y equipos",
    cancel: "Cancelar",
    noRole: "Sin rol",
    you: "(tú)",
    soon: "Pronto",
    availableSoon: "Disponible pronto",
    email: "Correo",
    status: "Estado",
    active: "Activo",
    inactive: "Inactivo",
    role: "Rol",
    reason: "Motivo",
    reasonHint: "Obligatorio. Queda registrado en la auditoría.",
  },
  nav: {
    main: "Principal",
    home: "Inicio",
    administration: "Administración",
    users: "Usuarios",
    signOut: "Cerrar sesión",
    comingSoon: ["Equipos", "Órdenes de reparación", "Horómetros", "Facturas", "Reportes"],
  },
  login: {
    title: "Iniciar sesión",
    pageTitle: "Iniciar sesión - Parkline",
    subtitle: "Usa la cuenta que te entregó tu administrador.",
    pitch: "Conoce lo que hace tu flota y lo que te cuesta.",
    note: "Disponibilidad, reparaciones, preventivos y facturas en un solo lugar.",
    emailLabel: "Correo",
    emailPlaceholder: "tu@ejemplo.com",
    passwordLabel: "Contraseña",
    passwordPlaceholder: "Tu contraseña",
    submit: "Iniciar sesión",
    submitting: "Iniciando sesión...",
  },
  home: {
    pageTitle: "Inicio - Parkline",
    welcome: "Te damos la bienvenida a Parkline",
    empty: "Aún no hay datos cargados. Configura tu flota en tres pasos.",
    stepLabel: (n: number): string => `Paso ${String(n)}`,
    steps: [
      { title: "Agregar proveedores", text: "Quiénes te alquilan equipos.", cta: "Agregar proveedor" },
      { title: "Agregar operaciones y sitios", text: "Dónde trabajan los equipos.", cta: "Agregar operación" },
      { title: "Agregar equipos", text: "Cada unidad con su proveedor y número.", cta: "Agregar equipo" },
    ],
    preview: {
      title: "Qué verás aquí",
      text: "La disponibilidad, las órdenes de reparación abiertas, los preventivos y el costo mensual aparecerán en cuanto haya datos.",
    },
  },
  users: {
    pageTitle: "Usuarios - Parkline",
    title: "Usuarios",
    subtitle: "Quién puede iniciar sesión y qué puede hacer.",
    restrictedTitle: "No tienes permiso para administrar usuarios",
    restrictedText: "Pide acceso a un administrador de sistemas si lo necesitas.",
    tableCaption: "Usuarios de esta organización",
    columns: { name: "Nombre", email: "Correo", role: "Rol", status: "Estado", actions: "Acciones" },
  },
  dialogs: {
    newUser: {
      trigger: "Nuevo usuario",
      title: "Nuevo usuario",
      description: "Podrá iniciar sesión con el correo y la contraseña inicial que definas.",
      submit: "Crear usuario",
      nameLabel: "Nombre para mostrar",
      namePlaceholder: "Nombre completo",
      emailLabel: "Correo",
      emailPlaceholder: "nombre@ejemplo.com",
      passwordLabel: "Contraseña inicial",
      passwordPlaceholder: (min: number): string => `Al menos ${String(min)} caracteres`,
      passwordHint: (min: number): string =>
        `Al menos ${String(min)} caracteres. Compártela por un canal seguro.`,
    },
    changeRole: {
      trigger: "Cambiar rol",
      title: "Cambiar rol",
      description: (name: string): string => `${name} perderá los permisos del rol anterior.`,
      submit: "Guardar rol",
      scopeHint: "Por ahora solo está disponible el alcance de organización.",
      reasonPlaceholder: "¿Por qué cambia el rol?",
    },
    deactivate: {
      trigger: "Desactivar",
      title: (name: string): string => `¿Desactivar a ${name}?`,
      description:
        "Se cerrará su sesión en todos los dispositivos y no podrá volver a iniciar sesión hasta que se reactive.",
      submit: "Desactivar usuario",
      reasonPlaceholder: "¿Por qué se desactiva a este usuario?",
    },
  },
  errors: {
    generic: "Algo salió mal. Inténtalo de nuevo.",
    rejected: "La solicitud fue rechazada. Recarga la página e inténtalo de nuevo.",
    login: "Correo o contraseña incorrectos.",
    checkForm: "Revisa el formulario e inténtalo de nuevo.",
    byCode: {
      reason_required: "Ingresa un motivo. Queda registrado en la auditoría.",
      weak_password: "La contraseña debe tener al menos 12 caracteres.",
      email_taken: "Ese correo ya lo usa otro usuario.",
      last_admin_protected:
        "El último administrador de sistemas activo no puede perder el rol ni ser desactivado.",
      cannot_deactivate_self: "No puedes desactivar tu propia cuenta.",
      forbidden: "No tienes permiso para hacer eso.",
      role_unchanged: "El usuario ya tiene ese rol.",
      user_inactive: "Ese usuario está desactivado.",
      not_found: "Ese usuario ya no existe.",
      invalid_role: "Elige un rol válido.",
      unauthenticated: "Tu sesión terminó. Inicia sesión de nuevo.",
    },
    byField: {
      displayName: "Ingresa un nombre para mostrar.",
      email: "Ingresa un correo válido.",
      reason: "Ingresa un motivo. Queda registrado en la auditoría.",
    },
    page: {
      title: "Algo salió mal",
      text: "No se pudo cargar la página. Inténtalo de nuevo en unos momentos.",
      retry: "Intentar de nuevo",
    },
    notFound: {
      title: "Página no encontrada",
      text: "La página que buscas no existe o fue movida.",
      home: "Ir al inicio",
    },
  },
  roles: {
    admin: "Administrador de sistemas",
    fleet_analyst: "Analista de flota",
    manager: "Gerente",
    supervisor: "Supervisor",
    viewer: "Visualizador",
  },
  meta: {
    lang: "es",
    title: "Parkline",
    description: "Gestión de flota y equipos",
  },
} as const;

export type Copy = typeof es;

export const copy: Copy = es;
