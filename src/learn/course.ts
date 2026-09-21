import type { Locale } from "../i18n/locale";

/** Teaching content is tied to the shipped, tested engines, not a future course. */
export type LessonGuide = {
  module: string;
  minutes: number;
  forum: string;
  introduction: string;
  objectives: readonly string[];
  exercise: readonly string[];
  question: string;
  answer: string;
};

type GuideText = Omit<LessonGuide, "minutes" | "forum">;

export const GUIDES: Record<string, LessonGuide> = {
  i01: {
    module: "Fundamentos",
    minutes: 12,
    forum: "effect-gen",
    introduction:
      "Un Effect es una descripción de trabajo. Effect.gen permite componer esas descripciones usando yield*, con una lectura parecida a async/await. Construir el valor no inicia el programa: un runtime lo ejecuta cuando vos lo decidís.",
    objectives: [
      "Distinguir un programa de su ejecución.",
      "Seguir el orden de yield* y reconocer un paso que nunca se alcanza.",
    ],
    exercise: [
      "Elegí two-steps y usá Describe. Anotá el valor que esperás obtener; todavía no se ejecutó el programa.",
      "Usá Run y compará value y trace con tu predicción.",
      "Cambiá a fail-short-circuit. Antes de ejecutar, predecí qué paso queda sin correr. Buscá la evidencia en la traza.",
    ],
    question: "¿Por qué el tercer paso no se ejecuta cuando falla el segundo?",
    answer:
      "yield* propaga el fallo por el canal de error y termina esa secuencia. Para continuar hay que recuperar el error de forma explícita. Describe muestra la estructura definida para el ejemplo; no es una traza ni una inspección automática del runtime.",
  },
  i02: {
    module: "Fundamentos",
    minutes: 15,
    forum: "errors",
    introduction:
      "Los fallos esperados también son datos. Un error con etiqueta permite distinguir casos sin buscar palabras en un mensaje. El tipo Effect<Éxito, Error, Requisitos> mantiene visible el canal de error mientras componés el programa.",
    objectives: [
      "Separar un fallo esperado de un resultado exitoso.",
      "Observar cómo catchTag recupera una etiqueta concreta.",
    ],
    exercise: [
      "Inspeccioná los presets con Describe y localizá el punto de fallo.",
      "Ejecutá el caso que falla y comparalo con el que usa catchTag. Revisá el valor final y los pasos de recuperación.",
      "Explicá qué debería pasar si la etiqueta del error no coincidiera con la que recupera el handler.",
    ],
    question: "¿Recuperar un error equivale a ignorarlo?",
    answer:
      "No. El handler decide un nuevo programa para ese caso: puede producir un valor alternativo o fallar de otra manera. catchTag sólo maneja la etiqueta elegida. Un defecto inesperado no se convierte automáticamente en ese error de dominio.",
  },
  i03: {
    module: "Composición",
    minutes: 15,
    forum: "layers",
    introduction:
      "Una función que necesita configuración o un repositorio puede declarar ese servicio como requisito. Context.Service identifica el contrato; una Layer describe cómo proveerlo. El programa puede conservar su lógica mientras cambiás la implementación que recibe.",
    objectives: [
      "Reconocer un requisito de servicio.",
      "Comparar dos implementaciones provistas al mismo programa.",
    ],
    exercise: [
      "Describí cada preset y buscá el servicio que consume el programa.",
      "Ejecutá las variantes provistas por el lab y compará sus resultados.",
      "Pensá en un servicio de tu aplicación: escribí su contrato y una implementación de prueba sin red.",
    ],
    question: "¿Layer.succeed inicia una conexión a una base de datos?",
    answer:
      "Layer.succeed provee un valor ya disponible. Este lab usa implementaciones en memoria. Una conexión real necesita adquisición y liberación de recursos; no hay que atribuirle ese comportamiento al ejemplo simplificado.",
  },
  i04: {
    module: "Composición",
    minutes: 18,
    forum: "concurrency",
    introduction:
      "Las tareas concurrentes necesitan una relación de vida: quién espera a quién y qué pasa con el trabajo pendiente. Effect.all reúne resultados; Effect.race busca el primer éxito. El lab permite comparar sus resultados con un resumen didáctico de los pasos.",
    objectives: [
      "Distinguir reunir resultados de competir por un éxito.",
      "Reconocer el ganador de una carrera y los límites de la traza didáctica.",
    ],
    exercise: [
      "Compará los planes de all y race antes de ejecutarlos.",
      "Ejecutá ambos y localizá el resultado. La traza resume el ejemplo; no instrumenta todos los eventos de las fibras.",
      "Compará all-one-fails con race-fast-wins. El primer caso muestra un fallo de all; el segundo, una carrera entre dos éxitos.",
    ],
    question: "¿race es una forma de ejecutar una tarea en segundo plano para siempre?",
    answer:
      "No. La carrera mantiene una relación con sus participantes y cancela el trabajo perdedor al resolverse. La traza de este lab no mide la interrupción y sus demoras son controladas. Para todos los resultados, elegí la composición correspondiente y definí su concurrencia.",
  },
  i05: {
    module: "Resiliencia",
    minutes: 12,
    forum: "concurrency",
    introduction:
      "Reintentar es volver a ejecutar un programa que falló. Schedule expresa la política que permite o detiene esa repetición. La cantidad de reintentos no es la cantidad total de intentos: también existe la ejecución inicial.",
    objectives: [
      "Contar ejecución inicial y reintentos por separado.",
      "Reconocer cuándo se agota una política de retry.",
    ],
    exercise: [
      "Describí la política de cada preset y predecí cuántos intentos habrá.",
      "Ejecutá un caso que se recupera y otro que agota los reintentos. Contá los eventos.",
      "Antes de llevar retry a una operación real, identificá si repetirla puede duplicar una escritura o un cobro.",
    ],
    question: "¿Schedule.recurs(2) permite dos intentos en total?",
    answer:
      "Permite dos recurrencias además de la ejecución inicial: hasta tres intentos si el programa sigue fallando. Si tiene éxito antes, retry termina. Este lab no simula backoff ni un servicio externo.",
  },
  i06: {
    module: "Resiliencia",
    minutes: 15,
    forum: "schema-scope",
    introduction:
      "Los tipos de TypeScript no validan el JSON que llega por la red. Schema describe una frontera que puede comprobar valores desconocidos en tiempo de ejecución. Decode y encode tienen direcciones distintas y pueden fallar según el contrato.",
    objectives: [
      "Distinguir una anotación de tipo de una validación en runtime.",
      "Comparar un objeto válido con una entrada rechazada por Schema.Struct.",
    ],
    exercise: [
      "Describí los campos del schema y predecí qué entrada será rechazada.",
      "Ejecutá los casos de decode válido e inválido. Inspeccioná el dato o error que devuelve el motor.",
      "Compará con encode. Explicá en qué frontera de tu aplicación ubicarías cada operación.",
    ],
    question: "¿Una conversión con as valida una entrada desconocida?",
    answer:
      "No. as cambia la interpretación del compilador y desaparece al ejecutar. La decodificación del schema realiza comprobaciones reales. Este ejemplo usa un Struct pequeño; no representa por sí solo una política completa de validación de una API.",
  },
  i07: {
    module: "Resiliencia",
    minutes: 15,
    forum: "schema-scope",
    introduction:
      "Un recurso necesita un final claro. Effect.acquireRelease une la adquisición con su limpieza dentro de un Scope y Effect.scoped delimita su vida. La liberación debe ocurrir también cuando el uso termina con un fallo, no sólo en el camino exitoso.",
    objectives: [
      "Verificar que la limpieza ocurre después de un fallo.",
      "Leer el orden inverso en que se liberan dos recursos adquiridos en un mismo scope.",
    ],
    exercise: [
      "Ejecutá success-release y anotá la secuencia de lifecycle.",
      "Predecí fail-still-releases y verificá que release siga presente aunque ok sea false.",
      "Ejecutá nested-order. El nombre es histórico: este motor adquiere dos recursos en un mismo scope. Compará el orden de adquisición con el de liberación.",
    ],
    question: "¿El preset nested-order demuestra scopes anidados?",
    answer:
      "No. Adquiere dos recursos en el mismo scope, que se liberan en orden inverso (LIFO). Los nombres outer e inner son etiquetas del ejemplo. No hay conexiones reales ni scopes hijos en ese preset.",
  },
};

/** Portuguese text for each guide. Minutes and forum come from GUIDES. */
const GUIDES_PT: Record<string, GuideText> = {
  i01: {
    module: "Fundamentos",
    introduction:
      "Um Effect é uma descrição de trabalho. Effect.gen permite compor essas descrições com yield*, com uma leitura parecida com async/await. Construir o valor não inicia o programa: um runtime o executa quando você decide.",
    objectives: [
      "Distinguir um programa da sua execução.",
      "Seguir a ordem dos yield* e reconhecer um passo que nunca é alcançado.",
    ],
    exercise: [
      "Escolha two-steps e use Describe. Anote o valor que você espera obter; o programa ainda não foi executado.",
      "Use Run e compare value e trace com a sua previsão.",
      "Mude para fail-short-circuit. Antes de executar, preveja qual passo fica sem rodar. Procure a evidência no trace.",
    ],
    question: "Por que o terceiro passo não é executado quando o segundo falha?",
    answer:
      "yield* propaga a falha pelo canal de erro e encerra essa sequência. Para continuar é preciso recuperar o erro de forma explícita. Describe mostra a estrutura definida para o exemplo; não é um trace nem uma inspeção automática do runtime.",
  },
  i02: {
    module: "Fundamentos",
    introduction:
      "As falhas esperadas também são dados. Um erro com etiqueta permite distinguir casos sem procurar palavras em uma mensagem. O tipo Effect<Sucesso, Erro, Requisitos> mantém o canal de erro visível enquanto você compõe o programa.",
    objectives: [
      "Separar uma falha esperada de um resultado bem-sucedido.",
      "Observar como catchTag recupera uma etiqueta específica.",
    ],
    exercise: [
      "Inspecione os presets com Describe e localize o ponto de falha.",
      "Execute o caso que falha e compare com o que usa catchTag. Confira o valor final e os passos de recuperação.",
      "Explique o que deveria acontecer se a etiqueta do erro não coincidisse com a que o handler recupera.",
    ],
    question: "Recuperar um erro é o mesmo que ignorá-lo?",
    answer:
      "Não. O handler decide um novo programa para esse caso: pode produzir um valor alternativo ou falhar de outra maneira. catchTag trata apenas a etiqueta escolhida. Um defeito inesperado não se converte automaticamente nesse erro de domínio.",
  },
  i03: {
    module: "Composição",
    introduction:
      "Uma função que precisa de configuração ou de um repositório pode declarar esse serviço como requisito. Context.Service identifica o contrato; uma Layer descreve como fornecê-lo. O programa mantém a sua lógica enquanto você troca a implementação que ele recebe.",
    objectives: [
      "Reconhecer um requisito de serviço.",
      "Comparar duas implementações fornecidas ao mesmo programa.",
    ],
    exercise: [
      "Descreva cada preset e procure o serviço que o programa consome.",
      "Execute as variantes fornecidas pelo lab e compare os resultados.",
      "Pense em um serviço da sua aplicação: escreva o contrato e uma implementação de teste sem rede.",
    ],
    question: "Layer.succeed abre uma conexão com um banco de dados?",
    answer:
      "Layer.succeed fornece um valor já disponível. Este lab usa implementações em memória. Uma conexão real precisa de aquisição e liberação de recursos; não atribua esse comportamento ao exemplo simplificado.",
  },
  i04: {
    module: "Composição",
    introduction:
      "Tarefas concorrentes precisam de uma relação de vida: quem espera quem e o que acontece com o trabalho pendente. Effect.all reúne resultados; Effect.race busca o primeiro sucesso. O lab permite comparar os resultados com um resumo didático dos passos.",
    objectives: [
      "Distinguir reunir resultados de competir por um sucesso.",
      "Reconhecer o vencedor de uma corrida e os limites do trace didático.",
    ],
    exercise: [
      "Compare os planos de all e race antes de executá-los.",
      "Execute os dois e localize o resultado. O trace resume o exemplo; não instrumenta todos os eventos das fibras.",
      "Compare all-one-fails com race-fast-wins. O primeiro caso mostra uma falha de all; o segundo, uma corrida entre dois sucessos.",
    ],
    question: "race é uma forma de executar uma tarefa em segundo plano para sempre?",
    answer:
      "Não. A corrida mantém uma relação com os participantes e cancela o trabalho perdedor ao se resolver. O trace deste lab não mede a interrupção e as demoras são controladas. Para obter todos os resultados, escolha a composição correspondente e defina a concorrência.",
  },
  i05: {
    module: "Resiliência",
    introduction:
      "Tentar de novo é voltar a executar um programa que falhou. Schedule expressa a política que permite ou interrompe essa repetição. A quantidade de novas tentativas não é o total de tentativas: também existe a execução inicial.",
    objectives: [
      "Contar a execução inicial e as novas tentativas separadamente.",
      "Reconhecer quando uma política de retry se esgota.",
    ],
    exercise: [
      "Descreva a política de cada preset e preveja quantas tentativas haverá.",
      "Execute um caso que se recupera e outro que esgota as tentativas. Conte os eventos.",
      "Antes de levar retry a uma operação real, verifique se repeti-la pode duplicar uma escrita ou uma cobrança.",
    ],
    question: "Schedule.recurs(2) permite duas tentativas no total?",
    answer:
      "Permite duas recorrências além da execução inicial: até três tentativas se o programa continuar falhando. Se tiver sucesso antes, retry termina. Este lab não simula backoff nem um serviço externo.",
  },
  i06: {
    module: "Resiliência",
    introduction:
      "Os tipos do TypeScript não validam o JSON que chega pela rede. Schema descreve uma fronteira que consegue verificar valores desconhecidos em tempo de execução. Decode e encode têm direções diferentes e podem falhar conforme o contrato.",
    objectives: [
      "Distinguir uma anotação de tipo de uma validação em runtime.",
      "Comparar um objeto válido com uma entrada rejeitada por Schema.Struct.",
    ],
    exercise: [
      "Descreva os campos do schema e preveja qual entrada será rejeitada.",
      "Execute os casos de decode válido e inválido. Inspecione o dado ou o erro que o motor devolve.",
      "Compare com encode. Explique em qual fronteira da sua aplicação você colocaria cada operação.",
    ],
    question: "Uma conversão com as valida uma entrada desconhecida?",
    answer:
      "Não. as muda a interpretação do compilador e desaparece na execução. A decodificação do schema faz verificações reais. Este exemplo usa um Struct pequeno; sozinho, não representa uma política completa de validação de uma API.",
  },
  i07: {
    module: "Resiliência",
    introduction:
      "Um recurso precisa de um fim claro. Effect.acquireRelease une a aquisição à sua limpeza dentro de um Scope, e Effect.scoped delimita a sua vida. A liberação deve acontecer também quando o uso termina em falha, não só no caminho de sucesso.",
    objectives: [
      "Verificar que a limpeza acontece depois de uma falha.",
      "Ler a ordem inversa em que dois recursos adquiridos no mesmo scope são liberados.",
    ],
    exercise: [
      "Execute success-release e anote a sequência de lifecycle.",
      "Preveja fail-still-releases e verifique que release continua presente mesmo com ok igual a false.",
      "Execute nested-order. O nome é histórico: este motor adquire dois recursos no mesmo scope. Compare a ordem de aquisição com a de liberação.",
    ],
    question: "O preset nested-order demonstra scopes aninhados?",
    answer:
      "Não. Ele adquire dois recursos no mesmo scope, que são liberados em ordem inversa (LIFO). Os nomes outer e inner são etiquetas do exemplo. Não há conexões reais nem scopes filhos nesse preset.",
  },
};

export function guideForLab(id: string, locale: Locale = "es"): LessonGuide {
  const guide = GUIDES[id];
  if (!guide) throw new Error(`Missing course guide: ${id}`);
  if (locale === "es") return guide;
  const text = GUIDES_PT[id];
  if (!text) throw new Error(`Missing Portuguese course guide: ${id}`);
  return { ...guide, ...text };
}
