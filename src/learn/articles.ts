import type { Locale } from "../i18n/locale";

export type TeachingArticle = {
  summary: string;
  minutes: number;
  lab: string;
  sections: readonly { title: string; paragraphs: readonly string[]; code?: string }[];
};

export const ARTICLE_CONTENT: Record<string, TeachingArticle> = {
  a01: {
    summary:
      "De una secuencia de instrucciones a un programa que podés componer antes de ejecutarlo.",
    minutes: 5,
    lab: "effect-gen-playground",
    sections: [
      {
        title: "Un valor que describe trabajo",
        paragraphs: [
          "Al llamar a una función async, su cuerpo empieza a ejecutarse hasta la primera suspensión. Un valor Effect permite guardar la descripción de trabajo sin iniciarla. Podés pasarla a otra función, agregar recuperación de errores o proveer servicios antes de entregarla al runtime.",
          "Effect.gen organiza esa composición como una secuencia. Cada yield* incorpora otro Effect y obtiene su valor exitoso. Si ese paso falla, la secuencia deja de avanzar por el camino exitoso. No hace falta esconder el error en un valor nulo para que el compilador lo recuerde.",
        ],
        code: 'import { Effect } from "effect"\n\nconst programa = Effect.gen(function* () {\n  const saludo = yield* Effect.succeed("hola")\n  return `${saludo}, comunidad`\n})\n\n// La ejecución ocurre acá.\nconst resultado = Effect.runSync(programa)',
      },
      {
        title: "Componer primero, ejecutar en el borde",
        paragraphs: [
          "Si cada función interna ejecuta su propio programa, vuelve más difícil decidir desde afuera cómo manejar errores, dependencias y cancelación. Una práctica útil es retornar Effects desde la lógica de aplicación y ejecutarlos en un borde claro: el handler, el comando o el punto de entrada.",
          "runSync corresponde a programas que pueden completarse sin trabajo asíncrono. Un programa que espera red o timers necesita una ejecución asíncrona, como Effect.runPromise. El primer lab usa ejemplos pequeños para mantener visible la diferencia entre construir y correr.",
        ],
      },
      {
        title: "Una predicción antes del resultado",
        paragraphs: [
          "En el lab, elegí two-steps, leé su descripción y predecí el resultado. Después ejecutalo. Repetí con fail-short-circuit y buscá el paso que no llega a ocurrir.",
          "Describe es metadata escrita para enseñar el ejemplo. No inspecciona arbitrariamente un Effect ni ejecuta pasos para adivinarlos. Run sí llama al motor Effect. Esa frontera permite comparar una hipótesis con evidencia sin confundir una ilustración con una ejecución.",
        ],
      },
    ],
  },
  a02: {
    summary:
      "Modelar fallos esperados y elegir una recuperación que tenga sentido para el dominio.",
    minutes: 5,
    lab: "error-channel",
    sections: [
      {
        title: "El contrato también cuenta cómo falla",
        paragraphs: [
          "Una búsqueda puede no encontrar un usuario. Una entrada puede ser inválida. Son resultados previstos del dominio, aunque no sean éxitos. Al incluirlos en el canal de error, el programa conserva esa información mientras lo transformás y combinás.",
          "Una etiqueta identifica el caso sin depender de un mensaje para humanos. El mensaje puede cambiar; el contrato no debería depender de buscar una palabra dentro de un string.",
        ],
        code: 'import { Effect, Schema } from "effect"\n\nclass NoEncontrado extends Schema.TaggedError<NoEncontrado>()("NoEncontrado", {\n  id: Schema.String\n}) {}\n\nconst buscar = Effect.fail(new NoEncontrado({ id: "42" }))\nconst recuperar = buscar.pipe(\n  Effect.catchTag("NoEncontrado", () => Effect.succeed("invitado"))\n)',
      },
      {
        title: "Recuperar es una decisión de producto",
        paragraphs: [
          "Devolver un invitado puede ser razonable para una vista pública y equivocado para una operación privada. catchTag expresa qué caso recuperás y con qué nuevo programa. No convierte cualquier fallo en un éxito ni decide por vos si el valor alternativo es correcto.",
          "Conviene mantener separados los fallos previstos, los defectos inesperados y la interrupción. Una etiqueta de dominio no sustituye la observabilidad de un bug. Tampoco hay que ocultar una cancelación como si fuera un dato de negocio normal.",
        ],
      },
      {
        title: "Leé el camino que realmente ocurrió",
        paragraphs: [
          "El lab compara success-path, fail-no-catch y fail-catch-tag. Primero predecí qué pasos se alcanzan. Después compará el error o el valor final y la traza registrada por el ejemplo.",
          "Como ejercicio fuera del lab, elegí una operación de tu sistema. Enumerá dos fallos esperados y escribí qué debería hacer la interfaz con cada uno. Si ambos terminan en un mensaje genérico, revisá si el contrato está perdiendo información útil.",
        ],
      },
    ],
  },
  a03: {
    summary: "Declarar lo que una operación necesita y proveer implementaciones desde el borde.",
    minutes: 5,
    lab: "layer-graph",
    sections: [
      {
        title: "Una dependencia visible",
        paragraphs: [
          "Cuando una operación lee configuración global o construye su propio cliente de red, sus requisitos quedan escondidos. Un servicio de Context permite declarar ese contrato y pedirlo desde el programa. El canal de requisitos conserva lo que falta proveer.",
          "En Effect 4, este curso usa Context.Service. El material de versiones anteriores puede usar APIs distintas; contrastá los ejemplos con la versión fijada por este proyecto antes de copiarlos.",
        ],
      },
      {
        title: "La misma lógica, otra implementación",
        paragraphs: [
          "El lab define un servicio pequeño y compara provide-live con provide-mock. Ambas variantes son implementaciones locales: la palabra live no implica una llamada a producción. El programa consume el mismo contrato y obtiene valores distintos según lo que recibe.",
          "Layer.succeed provee un valor disponible. Otras construcciones pueden describir adquisición de servicios y dependencias entre ellos. Una Layer no es una excusa para abrir recursos sin delimitar cuándo se cierran.",
        ],
      },
      {
        title: "Probar el contrato, no sólo el resultado",
        paragraphs: [
          "El preset missing-service expone qué ocurre cuando el requisito no está disponible. Luego las variantes provistas permiten ejecutar la misma lógica. Observá el contraste antes de diseñar un mock que siempre devuelva el resultado que el test espera.",
          "Para una API real, pensá qué comportamientos debería compartir el servicio de prueba con la implementación de red: casos vacíos, fallos esperados y cancelación. Un mock útil permite probar decisiones del consumidor; no promete que una base de datos real funcione igual.",
        ],
      },
    ],
  },
  a04: {
    summary: "Razonar sobre el trabajo concurrente a partir de su resultado y su tiempo de vida.",
    minutes: 6,
    lab: "fiber-race-all",
    sections: [
      {
        title: "Quién espera a quién",
        paragraphs: [
          "Lanzar dos tareas es sólo una parte del problema. También necesitás decidir qué resultado espera el padre, qué ocurre si una tarea falla y quién se ocupa del trabajo restante cuando el padre termina. La concurrencia estructurada da una relación a esos tiempos de vida.",
          "Effect.all combina resultados de una colección. Que el combinador reciba varias operaciones no basta para concluir que corren en paralelo: la concurrencia se configura. Sin esa opción, Effect.all corre sus operaciones en secuencia. Por eso el preset all-success de este curso pide concurrency: 'unbounded' de forma explícita.",
        ],
      },
      {
        title: "Una carrera por el éxito",
        paragraphs: [
          "Effect.race busca un primer éxito y se ocupa de interrumpir al perdedor. Ese contrato es distinto de elegir la primera finalización sin considerar si tuvo éxito. No conviene inferir tiempos de producción a partir de una carrera de ejemplo.",
          "El lab usa tareas y demoras controladas. Parte de su traza es un resumen didáctico construido por el motor, no un profiler de fibras. El valor final muestra la ejecución real; los rótulos ayudan a leerla, sin prometer todos los eventos internos.",
        ],
      },
      {
        title: "La vida del recurso también importa",
        paragraphs: [
          "Cancelar trabajo no debería dejar recursos abiertos. El último lab conecta esta idea con Scope: registra finalizadores y verifica que se ejecutan tanto después del éxito como después de un fallo.",
          "Como ejercicio, dibujá una solicitud que consulta dos servicios. Marcá qué resultado necesita el usuario y qué debería pasar con la segunda consulta si la primera vuelve innecesaria la espera. Después elegí la composición; el nombre del combinador viene después de la decisión.",
        ],
      },
    ],
  },
};

type ArticleText = Omit<TeachingArticle, "minutes" | "lab">;

/** Portuguese text for each article. Minutes and lab come from ARTICLE_CONTENT. */
const ARTICLE_CONTENT_PT: Record<string, ArticleText> = {
  a01: {
    summary: "De uma sequência de instruções a um programa que você pode compor antes de executar.",
    sections: [
      {
        title: "Um valor que descreve trabalho",
        paragraphs: [
          "Ao chamar uma função async, o corpo dela começa a ser executado até a primeira suspensão. Um valor Effect permite guardar a descrição do trabalho sem iniciá-lo. Você pode passá-la para outra função, adicionar recuperação de erros ou fornecer serviços antes de entregá-la ao runtime.",
          "Effect.gen organiza essa composição como uma sequência. Cada yield* incorpora outro Effect e obtém o seu valor de sucesso. Se esse passo falha, a sequência deixa de avançar pelo caminho de sucesso. Não é preciso esconder o erro em um valor nulo para que o compilador se lembre dele.",
        ],
        code: 'import { Effect } from "effect"\n\nconst programa = Effect.gen(function* () {\n  const saudacao = yield* Effect.succeed("olá")\n  return `${saudacao}, comunidade`\n})\n\n// A execução acontece aqui.\nconst resultado = Effect.runSync(programa)',
      },
      {
        title: "Compor primeiro, executar na borda",
        paragraphs: [
          "Se cada função interna executa o próprio programa, fica mais difícil decidir de fora como tratar erros, dependências e cancelamento. Uma prática útil é retornar Effects da lógica da aplicação e executá-los em uma borda clara: o handler, o comando ou o ponto de entrada.",
          "runSync serve para programas que podem terminar sem trabalho assíncrono. Um programa que espera rede ou timers precisa de uma execução assíncrona, como Effect.runPromise. O primeiro lab usa exemplos pequenos para manter visível a diferença entre construir e rodar.",
        ],
      },
      {
        title: "Uma previsão antes do resultado",
        paragraphs: [
          "No lab, escolha two-steps, leia a descrição e preveja o resultado. Depois execute. Repita com fail-short-circuit e procure o passo que não chega a acontecer.",
          "Describe é metadata escrita para ensinar o exemplo. Não inspeciona um Effect arbitrário nem executa passos para adivinhá-los. Run, sim, chama o motor Effect. Essa fronteira permite comparar uma hipótese com evidência sem confundir uma ilustração com uma execução.",
        ],
      },
    ],
  },
  a02: {
    summary: "Modelar falhas esperadas e escolher uma recuperação que faça sentido para o domínio.",
    sections: [
      {
        title: "O contrato também conta como falha",
        paragraphs: [
          "Uma busca pode não encontrar um usuário. Uma entrada pode ser inválida. São resultados previstos do domínio, mesmo não sendo sucessos. Ao incluí-los no canal de erro, o programa conserva essa informação enquanto você o transforma e combina.",
          "Uma etiqueta identifica o caso sem depender de uma mensagem para humanos. A mensagem pode mudar; o contrato não deveria depender de procurar uma palavra dentro de uma string.",
        ],
        code: 'import { Effect, Schema } from "effect"\n\nclass NaoEncontrado extends Schema.TaggedError<NaoEncontrado>()("NaoEncontrado", {\n  id: Schema.String\n}) {}\n\nconst buscar = Effect.fail(new NaoEncontrado({ id: "42" }))\nconst recuperar = buscar.pipe(\n  Effect.catchTag("NaoEncontrado", () => Effect.succeed("convidado"))\n)',
      },
      {
        title: "Recuperar é uma decisão de produto",
        paragraphs: [
          "Devolver um convidado pode ser razoável para uma página pública e errado para uma operação privada. catchTag expressa qual caso você recupera e com qual novo programa. Não converte qualquer falha em sucesso nem decide por você se o valor alternativo está correto.",
          "Convém manter separados as falhas previstas, os defeitos inesperados e a interrupção. Uma etiqueta de domínio não substitui a observabilidade de um bug. Também não se deve esconder um cancelamento como se fosse um dado de negócio normal.",
        ],
      },
      {
        title: "Leia o caminho que realmente aconteceu",
        paragraphs: [
          "O lab compara success-path, fail-no-catch e fail-catch-tag. Primeiro preveja quais passos são alcançados. Depois compare o erro ou o valor final e o trace registrado pelo exemplo.",
          "Como exercício fora do lab, escolha uma operação do seu sistema. Liste duas falhas esperadas e escreva o que a interface deveria fazer com cada uma. Se as duas terminam em uma mensagem genérica, veja se o contrato está perdendo informação útil.",
        ],
      },
    ],
  },
  a03: {
    summary: "Declarar o que uma operação precisa e fornecer implementações a partir da borda.",
    sections: [
      {
        title: "Uma dependência visível",
        paragraphs: [
          "Quando uma operação lê configuração global ou constrói o próprio cliente de rede, os requisitos dela ficam escondidos. Um serviço de Context permite declarar esse contrato e pedi-lo a partir do programa. O canal de requisitos guarda o que falta fornecer.",
          "No Effect 4, este curso usa Context.Service. O material de versões anteriores pode usar APIs diferentes; confira os exemplos com a versão fixada por este projeto antes de copiá-los.",
        ],
      },
      {
        title: "A mesma lógica, outra implementação",
        paragraphs: [
          "O lab define um serviço pequeno e compara provide-live com provide-mock. As duas variantes são implementações locais: a palavra live não implica uma chamada à produção. O programa consome o mesmo contrato e obtém valores diferentes conforme o que recebe.",
          "Layer.succeed fornece um valor disponível. Outras construções podem descrever a aquisição de serviços e as dependências entre eles. Uma Layer não é desculpa para abrir recursos sem delimitar quando são fechados.",
        ],
      },
      {
        title: "Testar o contrato, não só o resultado",
        paragraphs: [
          "O preset missing-service expõe o que acontece quando o requisito não está disponível. Depois, as variantes fornecidas permitem executar a mesma lógica. Observe o contraste antes de desenhar um mock que sempre devolve o resultado que o teste espera.",
          "Para uma API real, pense em quais comportamentos o serviço de teste deveria compartilhar com a implementação de rede: casos vazios, falhas esperadas e cancelamento. Um mock útil permite testar decisões do consumidor; não promete que um banco de dados real funcione igual.",
        ],
      },
    ],
  },
  a04: {
    summary: "Raciocinar sobre o trabalho concorrente a partir do resultado e do tempo de vida.",
    sections: [
      {
        title: "Quem espera quem",
        paragraphs: [
          "Lançar duas tarefas é só uma parte do problema. Você também precisa decidir qual resultado o pai espera, o que acontece se uma tarefa falha e quem cuida do trabalho restante quando o pai termina. A concorrência estruturada dá uma relação a esses tempos de vida.",
          "Effect.all combina resultados de uma coleção. O combinador receber várias operações não basta para concluir que elas rodam em paralelo: a concorrência é configurada. Sem essa opção, Effect.all roda as operações em sequência. Por isso o preset all-success deste curso pede concurrency: 'unbounded' de forma explícita.",
        ],
      },
      {
        title: "Uma corrida pelo sucesso",
        paragraphs: [
          "Effect.race busca um primeiro sucesso e se encarrega de interromper o perdedor. Esse contrato é diferente de escolher a primeira finalização sem considerar se teve sucesso. Não convém inferir tempos de produção a partir de uma corrida de exemplo.",
          "O lab usa tarefas e demoras controladas. Parte do trace é um resumo didático construído pelo motor, não um profiler de fibras. O valor final mostra a execução real; os rótulos ajudam a lê-la, sem prometer todos os eventos internos.",
        ],
      },
      {
        title: "A vida do recurso também importa",
        paragraphs: [
          "Cancelar trabalho não deveria deixar recursos abertos. O último lab conecta essa ideia com Scope: registra finalizadores e verifica que eles rodam tanto depois do sucesso quanto depois de uma falha.",
          "Como exercício, desenhe uma requisição que consulta dois serviços. Marque qual resultado o usuário precisa e o que deveria acontecer com a segunda consulta se a primeira tornar a espera desnecessária. Depois escolha a composição; o nome do combinador vem depois da decisão.",
        ],
      },
    ],
  },
};

export function articleContent(id: string, locale: Locale = "es"): TeachingArticle {
  const article = ARTICLE_CONTENT[id];
  if (!article) throw new Error(`Missing article: ${id}`);
  if (locale === "es") return article;
  const text = ARTICLE_CONTENT_PT[id];
  if (!text) throw new Error(`Missing Portuguese article: ${id}`);
  return { ...article, ...text };
}
