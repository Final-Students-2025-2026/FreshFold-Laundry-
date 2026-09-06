/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TranslationKey } from './en';

/**
 * Spanish.
 *
 * **Drafted here and not yet read by a native speaker.** It wants one before
 * release, like the French beside it. Complete, and written in the same
 * unhurried voice the English copy uses rather than the clipped imperative most
 * Spanish UI falls into.
 *
 * Choices worth knowing about:
 *
 * - **`usted`, not `tú`.** The register matches the French, which uses `vous`,
 *   and matches what the brand is: a concierge service addressing a patron. It
 *   is applied consistently — a dictionary that switches between the two
 *   halfway down reads as two people wrote it.
 * - **Neutral Spanish**, avoiding vocabulary that is regional. `recoger` for
 *   collection rather than `recolectar`, `móvil`/`teléfono` rather than
 *   `celular`, `pedido` for an order rather than `orden`.
 * - `settings.danger.confirmWord` is absent, so it falls back to `DELETE`. The
 *   word the customer types has to be the word the code compares against, and
 *   translating one half of that pair breaks the gate.
 * - Ghanaian addresses, the hub's name and the desk's opening hours are not
 *   translated anywhere in the app — they are the same place either way.
 * - Counted phrases keep the two-key `.one`/`.many` pattern. Spanish splits at
 *   exactly one, like English, so the call site's `count === 1` test is right
 *   here without a plural-rule engine.
 */
export const es: Partial<Record<TranslationKey, string>> = {
  // -------------------------------------------------------------- shared
  'common.back': 'Volver',
  'common.cancel': 'Cancelar',
  'common.keep': 'Conservar',
  'common.remove': 'Eliminar',
  'common.add': 'Añadir',
  'common.close': 'Cerrar',
  'common.saving': 'Guardando…',
  'common.sending': 'Enviando…',
  'common.default': 'Predeterminada',
  'common.signInCta': 'Iniciar sesión o crear una cuenta',
  'common.schedulePickup': 'Programar una recogida',
  'common.guest': 'Navegando como invitado',
  'common.unreachable':
    'No se pudo contactar con FreshFold. Revise su conexión e inténtelo de nuevo.',
  'common.offline': 'Sin conexión',
  'common.blank': '—',

  // ----------------------------------------------------------------- time
  //
  // Spanish puts «hace» before the interval, and keeps a space between the
  // number and its unit.
  'time.justNow': 'ahora mismo',
  'time.minutes': 'hace {count} min',
  'time.hours': 'hace {count} h',
  'time.days': 'hace {count} d',

  // -------------------------------------------------------------- courier
  'courier.unnamed': 'Su mensajero',
  'courier.vehiclePending': 'Datos del vehículo pendientes',

  // ---------------------------------------------------------------- status
  'status.job.unassigned': 'Sin asignar',
  'status.job.assigned': 'Asignado',
  'status.job.navigating_to_pickup': 'En camino a la recogida',
  'status.job.arrived_at_pickup': 'Ha llegado a la recogida',
  'status.job.pickup_scanned': 'Recogida escaneada',
  'status.job.picked_up': 'Recogido',
  'status.job.navigating_to_laundry': 'En camino a la lavandería',
  'status.job.arrived_at_laundry': 'Ha llegado a la lavandería',
  'status.job.dropped_off': 'Entregado en el taller',
  'status.job.processing': 'En proceso',
  'status.job.ready_for_delivery': 'Listo para la entrega',
  'status.job.navigating_to_delivery': 'En camino a la entrega',
  'status.job.arrived_at_delivery': 'Ha llegado a la entrega',
  'status.job.delivered': 'Entregado',
  'status.job.cancelled': 'Cancelado',

  'status.stage.Scheduled': 'Programado',
  'status.stage.Collecting': 'Recogiendo',
  'status.stage.In Care': 'En tratamiento',
  'status.stage.Ironing & Folding': 'Planchado y doblado',
  'status.stage.Quality Check': 'Control de calidad',
  'status.stage.Delivering': 'En entrega',
  'status.stage.Delivered': 'Entregado',
  'status.stage.Cancelled': 'Cancelado',

  'status.copy.Scheduled':
    'Su cita está registrada. Se le asignará un mensajero en breve.',
  'status.copy.Collecting':
    'Su mensajero está recogiendo las bolsas y se dirige al taller.',
  'status.copy.In Care':
    'Recibido en el taller. Clasificación y tratamiento botánico de manchas en curso.',
  'status.copy.Ironing & Folding': 'Planchado a mano y doblado de boutique en curso.',
  'status.copy.Quality Check':
    'Tejido y acabado revisados y empaquetados, a la espera de un mensajero.',
  'status.copy.Delivering':
    'Su mensajero va de camino a su puerta con el pedido terminado.',
  'status.copy.Delivered': 'Entregado y firmado. Gracias por elegir FreshFold.',
  'status.copy.Cancelled': 'Este pedido fue cancelado. No se recogerá nada más.',

  'status.payment.Pending': 'Pendiente',
  'status.payment.Paid': 'Pagado',
  'status.payment.Pay on Pickup': 'Pago en la recogida',
  'status.payment.Refunded': 'Reembolsado',

  // ------------------------------------------------------------------ home
  'home.greeting.morning': 'Buenos días',
  'home.greeting.afternoon': 'Buenas tardes',
  'home.greeting.evening': 'Buenas noches',
  'home.greetingNamed': '{greeting}, {name}',

  'home.live.label': 'En curso',
  'home.live.courier': '{name} · {vehicle}',
  'home.live.assigning': 'Asignando un mensajero',
  'home.live.track': 'Seguir en directo',
  'home.live.moreOne': '+1 pedido más en curso',
  'home.live.moreMany': '+{count} pedidos más en curso',

  'home.hero.eyebrow': 'FreshFold Laundry Co.',
  // The break lands on "recogido en su puerta", which is where the Spanish
  // sentence divides too.
  'home.hero.title': 'Cuidado textil de boutique,\nrecogido en su puerta.',
  'home.hero.body':
    'Lavado, planchado y tratamientos especializados acabados a mano en todo Kumasi: reservado en un minuto, seguido hasta su puerta.',
  'home.hero.plans': 'Planes',

  'home.quick.book': 'Reservar',
  'home.quick.track': 'Seguir',
  'home.quick.wallet': 'Cartera',
  'home.quick.foldie': 'Foldie',

  'home.services.title': 'Nuestros servicios',
  'home.services.caption': 'Precio por adelantado. Sin sorpresas en la puerta.',

  'home.steps.title': 'Cómo funciona',
  'home.steps.caption': 'Cuatro pasos, del cesto al armario.',

  'home.why.title': 'Por qué FreshFold',
  'home.why.caption': 'Lo que una lavandería corriente no le da.',

  'home.segments.title': 'Pensado para',
  'home.segments.caption': 'Toque uno para empezar una reserva a su medida.',


  'home.contact.title': 'Hable con nosotros',
  'home.contact.caption': 'Una persona, no un formulario.',
  'home.contact.phoneCaption': 'Llame al mostrador de conserjería',
  'home.contact.foldie': 'Pregunte a Foldie',
  'home.contact.foldieCaption': 'Nuestro asistente de conserjería, en la app',
  'home.contact.emailCaption': 'Para contratos y facturación',
  'home.contact.addressCaption': 'Donde cuidamos de sus prendas',
  'home.contact.hoursCaption': 'Las franjas de recogida llegan hasta el cierre',

  'home.footer':
    'FreshFold Laundry Co. · Ayeduase-Kotei, Kumasi\nCada pedido con precio antes de confirmar.',

  // ------------------------------------------------------------------ book
  'book.title': 'Programar una recogida',
  'book.stepOf': 'Paso {current} de {total} · {name}',
  'book.step.service': 'Servicio',
  'book.step.schedule': 'Fecha',
  'book.step.address': 'Dirección',
  'book.step.finishing': 'Acabado',
  'book.step.payment': 'Pago',

  'book.service.prompt': '¿Qué necesita cuidado?',
  'book.service.helper':
    'Toque para cambiar. Cada servicio se presupuesta antes de confirmar, y el mensajero es gratuito en todos ellos.',
  'book.picker.service': 'Elija un servicio',
  'service.priceFrom': 'Desde {amount} / {unit}',
  'book.extra.add': '+ Añadir otro servicio',
  'book.extra.change': 'Cambiar de servicio',
  'book.extra.remove': 'Quitar este servicio',

  /**
   * `de {unit}` en vez de «¿Cuántas…?»: la unidad llega en tiempo de ejecución
   * y su género no se puede concordar de antemano — «carga» es femenina,
   * «juego» masculino.
   */
  'book.quantity.title': 'Cantidad de {unit}',
  'book.quantity.each': '{amount} por {unit}',
  'book.quantity.fewer': 'Reducir la cantidad',
  'book.quantity.more': 'Aumentar la cantidad',

  // ----------------------------------------------------------- unidades
  'unit.load.one': 'carga',
  'unit.load.many': 'cargas',
  'unit.set.one': 'juego',
  'unit.set.many': 'juegos',
  // El servicio es el detallado de un coche, así que la unidad es el vehículo.
  'unit.ride.one': 'vehículo',
  'unit.ride.many': 'vehículos',
  'unit.space.one': 'espacio',
  'unit.space.many': 'espacios',
  'unit.unit.one': 'unidad',
  'unit.unit.many': 'unidades',
  'unit.order.one': 'pedido',
  'unit.order.many': 'pedidos',

  'book.plan.coveredTitle': 'Esta recogida está incluida en su membresía',
  'book.plan.title': 'Reservado con su membresía',
  'book.plan.coveredBody':
    'La colada ya está pagada: le quedan {left} de {total} recogidas este mes. Los extras se cobran a su tarifa de socio, y el pedido tiene prioridad en el reparto.',
  'book.plan.rateBody':
    'Ha agotado las recogidas incluidas de este mes, así que esta va a su tarifa de socio. Sigue teniendo prioridad en el reparto, y su cupo se renueva el {date}.',
  'book.plan.priorityBody': 'Este pedido tiene prioridad en el reparto.',

  'book.date.title': 'Fecha de recogida',
  'book.date.today': 'Hoy',
  /** Abbreviated to fit a 5-across row of date cells, as in English. */
  'book.date.tomorrow': 'Mañ.',
  'book.date.field': 'O escriba una fecha',
  // The field is parsed as ISO whatever this says, so the letters are renamed
  // without reordering them.
  'book.date.placeholder': 'AAAA-MM-DD',
  'book.date.hint': 'La entrega se programa para el día siguiente.',
  'book.return.title': 'Franja de entrega',
  'book.return.day': 'De vuelta el {date}',
  'book.return.tooEarly': 'Demasiado pronto — su ropa aún no habría vuelto',

  'standing.title': 'Pedidos fijos',
  'standing.subtitle': 'Las recogidas semanales que su plan ya paga.',
  'standing.yours': 'Sus pedidos fijos',
  'standing.none': 'Ninguno todavía. Cree uno abajo y lo reservaremos cada semana.',
  'standing.add': 'Añadir una recogida semanal',
  'standing.create': 'Crear pedido fijo',
  'standing.collectFrom': 'Se recoge en {address}.',
  'standing.needAddress': 'Guarde una dirección primero — un pedido fijo necesita un lugar de recogida.',
  'standing.failed': 'No se pudo guardar. Inténtelo de nuevo.',
  'standing.paused': 'En pausa',
  'standing.lastBooked': 'última reserva para el {date}',
  'standing.notYetBooked': 'aún sin reservar',
  'standing.remove.title': '¿Detener este pedido fijo?',
  'standing.remove.body': 'Las reservas ya hechas no se ven afectadas. No se reservará nada más.',
  'standing.signedOut.title': 'Inicie sesión para los pedidos fijos',
  'standing.signedOut.body': 'Las recogidas semanales van ligadas a su cuenta, para saber dónde ir y qué devolver.',
  'standing.referral.title': 'Invite a un amigo',
  'standing.referral.blurb': 'Recibe {welcome} de descuento en su primer pedido. Usted recibe {reward} cuando se entregue.',
  'standing.referral.count': '{invited} invitados · {rewarded} recompensados',
  'standing.referral.pending': 'Su código aparecerá aquí en un momento.',
  'standing.referral.claimLabel': '¿Tiene el código de un amigo?',
  'standing.referral.claim': 'Usar este código',
  'standing.referral.failed': 'No se pudo usar ese código.',

  'book.promo.title': 'Código promocional o de invitación',
  'book.promo.placeholder': 'FRESHERS24',
  'book.promo.apply': 'Aplicar',
  'book.promo.checking': 'Comprobando…',
  'book.promo.applied': '{code} aplicado — {amount} de descuento.',
  'book.promo.unreachable': 'No se pudo comprobar el código. Puede reservar igualmente.',
  'book.summary.promo': 'Código {code}',
  'book.summary.taxIncluded': 'Impuestos incluidos',

  'book.window.title': 'Franja de recogida',
  'book.window.full': 'Completa — elija otra franja',
  'book.window.remaining': 'Sólo quedan {count} en esta franja',

  'book.address.saved': 'Usar una dirección guardada',
  'book.picker.addresses': 'Direcciones guardadas',
  'book.address.hint':
    'Incluya el bloque y la habitación: es lo que el mensajero lee en la puerta.',
  'book.address.save': 'Guardar esta dirección para la próxima vez',

  'book.pin.title': '¿Dónde debe llamar el mensajero?',
  'book.pin.intro':
    'Una dirección es una frase; un mensajero necesita un punto. Coloque el pin en su portón o en la entrada de la residencia: es lo que sigue su navegación y lo que confirma su llegada.',

  'book.contact.title': '¿Por quién debe preguntar el mensajero?',
  'book.contact.name': 'Nombre completo',
  'book.contact.namePlaceholder': 'Ama Mensah',
  'book.contact.emailPlaceholder': 'usted@ejemplo.com',
  'book.contact.emailHint':
    'Opcional, pero es como vinculamos este pedido a una cuenta más adelante.',

  'book.scent.title': 'Aroma',
  'book.scent.noSurcharge': 'Sin recargo',
  'book.starch.title': 'Almidón en las prendas planchadas',
  'book.finish.noneTitle': 'Aquí no hay opciones de acabado',
  'book.finish.noneBody':
    'El aroma y el almidón se aplican a la ropa. {service} se presupuesta sobre el trabajo en sí: añada una nota abajo si hay algo concreto.',
  'book.addons.title': 'Extras especializados',
  'book.instructions.label': 'Instrucciones de cuidado',
  'book.instructions.placeholder':
    'El blazer azul marino tiene una mancha de café en el puño izquierdo.',
  'book.riderNote.label': 'Nota para el mensajero',
  'book.riderNote.placeholder': 'Llame al llegar al portón: el timbre está roto.',
  'book.riderNote.hint':
    'Se muestra en la ficha del mensajero, no al equipo de la lavandería.',

  'book.summary.title': 'Resumen',
  'book.summary.service': 'Servicio',
  'book.summary.pickup': 'Recogida',
  'book.summary.address': 'Dirección',
  'book.summary.pin': 'Pin de recogida',
  'book.summary.pinUnset': 'Sin definir',
  'book.summary.finish': 'Acabado',
  'book.summary.finishValue': '{scent}, almidón {starch}',
  'book.summary.addons': 'Extras',
  'book.summary.subtotal': 'Subtotal',
  'book.summary.planIncluded': '{plan} — recogida incluida',
  'book.summary.planFallback': 'Membresía',
  'book.summary.memberRate': 'Tarifa de socio',
  'book.summary.tierDiscount': 'Descuento {tier}',
  'book.summary.total': 'Total',
  /** The dash is a minus sign, U+2212, as in English. */
  'book.summary.less': '− {amount}',

  'book.pay.title': '¿Cómo desea pagar?',
  'book.pay.walletBalance': 'Saldo {amount}',
  'book.pay.walletShort': 'Saldo {amount} — insuficiente',
  'book.pay.paystackTitle': 'Pago seguro con Paystack',
  'book.pay.paystackBody':
    'Abre Paystack en un navegador. Ningún dato de su tarjeta se introduce en esta app ni lo guarda FreshFold.',
  'book.pay.open': 'Abrir el pago',
  'book.pay.reopen': 'Reabrir el pago',
  'book.pay.verify': 'Ya he pagado — verificar',
  'book.pay.doorTitle': 'Pagar en la puerta',
  'book.pay.doorBody':
    'El mensajero lleva datáfono y acepta dinero móvil. Su pedido queda confirmado igualmente.',
  'book.pay.gateway': 'Pasarela de pago: {message}',
  'book.pay.gatewayUnreachable':
    'No se pudo contactar con la pasarela de pago. Revise su conexión o elija Pago en la recogida.',
  'book.pay.finishOnPage':
    'Termine en la página de Paystack y luego toque «Ya he pagado» para verificar.',
  'book.pay.browserFailed':
    'No se pudo abrir la página de pago aquí. La referencia {reference} está activa: abra Paystack, pague y luego toque «Ya he pagado».',
  'book.pay.confirmed': 'Pago confirmado.',
  'book.pay.pending': 'Paystack dice: {status}. Complete el pago y vuelva a intentarlo.',
  'book.pay.pendingStatus': 'pendiente',
  'book.pay.verifyUnreachable':
    'No se pudo contactar con FreshFold para confirmar el pago. Si se le ha cobrado, su dinero está a salvo: toque «Ya he pagado» de nuevo en un momento.',
  'book.pay.bookedThen': 'Recogida reservada. {message}',
  'book.pay.bookedUnsettled':
    'Recogida reservada, pero no pudimos cobrar el pago. Liquídelo desde su cartera.',

  'book.error.date': 'Elija una fecha de recogida.',
  'book.error.address': 'Necesitamos una dirección donde recoger.',
  'book.error.pin': 'Coloque el pin de recogida para que el mensajero sepa dónde llamar.',
  'book.error.name': 'Díganos por quién debe preguntar en la puerta.',
  'book.error.phone': 'Un número de teléfono permite al mensajero localizarle.',
  'book.error.paystackEmail':
    'Añada su correo electrónico para pagar en línea: Paystack envía allí el recibo.',
  'book.error.walletSignIn': 'Inicie sesión para pagar con su cartera FreshFold.',
  'book.error.walletShort':
    'Su cartera tiene {amount}. Elija otro método o recargue el saldo.',
  'book.error.save':
    'No se pudo guardar esa reserva. Está en cola y se enviará cuando vuelva a tener conexión.',

  'book.quote.due': 'Total a pagar',
  'book.quote.running': 'Presupuesto actual',
  'book.quote.before': '{amount} antes de su {reason}',
  'book.quote.reasonIncluded': 'recogida incluida',
  'book.quote.reasonBoth': 'tarifa de socio y de nivel',
  'book.quote.reasonMember': 'tarifa de socio',
  'book.quote.reasonTier': 'descuento de nivel',
  'book.continue': 'Continuar',
  'book.confirm': 'Confirmar reserva',

  'book.done.title': 'Reservado',
  // One sentence in two keys, because the reference between them is bold. The
  // reference follows the word for "reference" in Spanish too.
  'book.done.bodyBefore': 'La referencia',
  'book.done.bodyAfter':
    'está en el tablero de reparto. Un mensajero la aceptará en breve y podrá seguirle desde la pestaña Seguir.',
  'book.done.collection': 'Recogida',
  'book.done.return': 'Devolución',
  'book.done.paid': 'Pagado',
  'book.done.another': 'Reservar otra',
  'book.done.track': 'Seguirlo',

  // ----------------------------------------------------------------- track
  'track.title': 'Seguir',

  'track.empty.title': 'Nada en curso',
  'track.empty.body':
    'En cuanto reserve una recogida, el avance del mensajero aparecerá aquí en tiempo real.',

  'track.pending.title': 'Asignando un mensajero',
  'track.pending.body':
    'Su reserva está en el tablero de reparto. En cuanto un mensajero la acepte, su posición y su contacto aparecerán aquí.',

  'track.section.door': 'En la puerta',
  'track.section.order': 'Este pedido',

  'track.action.scan': 'Verificar bolsas',
  'track.action.scanCaption': 'Escanee usted mismo el listado',
  'track.action.issue': 'Informar de un problema',
  'track.action.issueCaption': 'Fotografíe una prenda',
  'track.action.chat': 'Conversación',
  'track.action.chatCaption': 'Escribir a reparto',
  'track.action.chatOne': '1 mensaje',
  'track.action.chatMany': '{count} mensajes',
  'track.action.full': 'Pedido completo',
  'track.action.fullCaption': 'Listado, pruebas, recibo',

  'track.row.payment': 'Pago',
  'track.row.paymentValue': '{status} · {method}',
  'track.row.collectionValue': '{date} · {time}',
  'track.open': 'Abrir el pedido completo',

  'track.call': 'Llamar al mensajero',
  'track.message': 'Escribir al mensajero',

  'track.dispatch': 'Reparto: {status}',

  // --------------------------------------------------------------- handoff
  'handoff.label': 'Código de recogida',
  'handoff.atDoor': 'Su mensajero está en la puerta',
  'handoff.waiting': 'Muestre esto cuando llegue el mensajero',
  'handoff.body':
    'Su mensajero escaneará el código o le pedirá los cuatro dígitos. No entregue las bolsas a nadie que no pueda comprobarlo.',
  'handoff.hide': 'Ocultar',
  'handoff.hideLabel': 'Ocultar el código de recogida',
  'handoff.show': 'Mostrar de nuevo el QR y el código',
  'handoff.showLabel': 'Mostrar el código de recogida',
  'handoff.tied':
    'El código está vinculado al pedido {id} y sólo sirve para esta recogida.',

  // ------------------------------------------------------------------- map
  'map.home': 'Su dirección',
  'map.recenter': 'Centrar el mapa en su mensajero',
  'map.eta': 'a {minutes} min',
  'map.noPin': 'Esta reserva todavía no tiene pin de recogida.',
  'map.failed':
    'No se pudo cargar el mapa en este dispositivo ({message}). Las posiciones siguen en directo abajo.',
  'map.readout': 'Lectura de posición',
  'map.webNotice':
    'Los mapas en directo se muestran en iOS y Android. Abra la app en un móvil para verlo.',
  'map.expoNotice':
    'Los mapas en directo se muestran en iOS y Android. Abra la app en Expo Go para verlo.',
  'map.hubDetail': 'Donde cuidamos de sus prendas',
  'map.noPinYet': 'Sin pin todavía',

  // ----------------------------------------------------------------- order
  'order.title': 'Pedido',
  'order.missing.title': 'Pedido no encontrado',
  'order.missing.body':
    'Esta referencia no está en su historial. Si lo reservó en la web, inicie sesión con el mismo correo para verlo aquí.',

  'order.claims.title': 'Problemas que ha reportado',
  'order.claims.status.open': 'Reportado',
  'order.claims.status.investigating': 'En revisión',
  'order.claims.status.upheld': 'Aceptado — le debemos',
  'order.claims.status.rejected': 'No aceptado',
  'order.claims.status.resolved': 'Resuelto',
  'order.claims.credited': '{amount} abonados a su monedero.',
  'order.claims.retreatment': 'Volveremos a tratarlo por nuestra cuenta.',

  'order.reschedule.action': 'Cambiar esta recogida',
  'order.reschedule.title': 'Cambiar esta recogida',
  'order.reschedule.date': 'Nueva fecha de recogida',
  'order.reschedule.confirm': 'Cambiar recogida',
  'order.reschedule.movesLeft': 'Puede cambiar esta reserva {count} veces más.',
  'order.reschedule.lastMove':
    'Es la última vez que puede cambiar esta reserva. Después, cancele y reserve de nuevo.',
  'order.reschedule.failed': 'No se pudo cambiar ahora mismo. Inténtelo de nuevo.',

  'order.cancel.action': 'Cancelar este pedido',
  'order.cancel.title': '¿Cancelar este pedido?',
  'order.cancel.body':
    'Se avisará al mensajero de que no acuda. Lo ya pagado se devuelve a su cartera desde el mostrador de conserjería.',
  'order.cancel.keep': 'Conservarlo',
  'order.cancel.confirm': 'Cancelar pedido',
  'order.cancel.failed': 'No se ha podido cancelar ahora mismo. Inténtelo de nuevo.',

  'order.section.actions': 'Lo que puede hacer',
  'order.section.manifest': 'Listado de bolsas',
  'order.section.details': 'Detalles',
  'order.section.proof': 'Prueba del servicio',

  'order.sign.title': 'Firmar la entrega',
  'order.sign.captionCode':
    'Su mensajero está en la puerta. Léale el código {code}.',
  'order.sign.caption': 'Su mensajero está en la puerta.',

  'order.scan.title': 'Verificar el listado de bolsas',
  'order.scan.checked': '{count} de {total} comprobadas por usted',
  'order.scan.bagsOne': '1 bolsa en este pedido',
  'order.scan.bagsMany': '{count} bolsas en este pedido',

  'order.issue.caption': 'Fotografíe una prenda y cuéntenos qué ha pasado',
  'order.chat.caption': 'Escriba al mensajero o a reparto',

  'order.call.title': 'Llamar al mostrador de conserjería',
  'order.call.caption': 'Sobre {name} · {vehicle}',

  'order.manifest.verified': '{count}/{total} verificadas por usted',
  'order.bag.meta': '{code} · {items} prendas · {weight}',
  'order.bag.metaNoWeight': '{code} · {items} prendas',
  'order.bag.uncounted': '{code} · se cuenta al llegar al taller',

  'order.row.booked': 'Reservado',
  'order.row.plan': 'Plan',
  'order.row.quantity': 'Cantidad',
  'order.row.care': 'Notas de cuidado',
  'order.row.courierNote': 'Nota del mensajero',
  'order.row.courier': 'Mensajero',
  'order.row.courierValue': '{name} · {status}',

  'order.proof.pickupPhoto': 'Recogido',
  'order.proof.pickupSignature': 'Firmado en la recogida',
  'order.proof.deliveryPhoto': 'Entregado',
  'order.proof.deliverySignature': 'Firmado en la entrega',
  'order.proof.vector': 'Firma registrada',

  'order.receipt.open': 'Ver el recibo',
  'order.receipt.collected': 'Recogida',
  'order.receipt.returned': 'Devolución',
  'order.receipt.method': 'Método',
  'order.receipt.status': 'Estado',
  'order.receipt.reference': 'Referencia',

  'order.again': 'Volver a reservar esto',
  'order.rate.title': '¿Qué tal ha ido?',
  'order.rate.prompt': 'Valore a {name}: es sólo un toque, y el mostrador las lee todas.',
  'order.rate.thanks': 'Gracias. Su valoración está en el mostrador.',
  'order.rate.star': '{count} de 5',

  // --------------------------------------------------------------- scanner
  'scanner.title': 'Compruebe sus bolsas',
  'scanner.mode.checklist': 'Lista',
  'scanner.mode.camera': 'Escanear con la cámara',

  'scanner.hint.initial':
    'Sostenga una etiqueta de bolsa dentro del marco, o márquelas a mano.',
  'scanner.hint.checked': '{code} comprobada.',
  'scanner.hint.all': 'Todas las bolsas localizadas.',
  'scanner.hint.verified': '{code} verificada — {type}.',
  'scanner.hint.foreign': '«{code}» no forma parte de {reference}.',
  'scanner.hint.declined':
    'Acceso a la cámara denegado: marque las bolsas a mano.',
  'scanner.hint.live':
    'Cámara activa. Alinee una etiqueta de bolsa FreshFold dentro del marco.',

  'scanner.empty.title': 'Cada bolsa lleva un código impreso',
  'scanner.empty.body':
    'Escanéelas al salir, o al volver, y lleve su propia cuenta.',

  'scanner.manifest': 'Listado ({count}/{total})',
  'scanner.tickAll': 'Marcar todas',
  'scanner.bag.meta': '{code} · {items} prendas',
  'scanner.checked': 'Comprobada',
  'scanner.tick': 'Marcar',
  'scanner.confirmNone': 'Marque una bolsa primero',
  'scanner.confirmOne': 'Confirmar 1 bolsa',
  'scanner.confirmMany': 'Confirmar {count} bolsas',

  // ----------------------------------------------------------------- issue
  'issue.title': 'Informar de un problema',
  'issue.subtitle':
    'Cualquier cosa que no esté bien se vuelve a tratar por nuestra cuenta: cuéntenos qué ha pasado.',

  'issue.reason.stain': 'Una prenda volvió con una mancha todavía puesta',
  'issue.reason.missing': 'Falta algo en la bolsa',
  'issue.reason.damaged': 'Una prenda se dañó',
  'issue.reason.finish': 'El acabado no es el que pedí',
  'issue.reason.late': 'El pedido llegó tarde',

  'issue.field': '¿Qué ha pasado?',
  'issue.placeholder':
    'El blazer azul marino tiene una marca en el puño izquierdo que ya estaba al devolverlo.',

  'issue.camera.take': 'Hacer foto',
  'issue.camera.title': 'Añadir una foto',
  'issue.camera.body':
    'Una imagen resuelve la mayoría de estos casos en un solo mensaje: es opcional, pero ayuda.',
  'issue.camera.enable': 'Activar la cámara',
  'issue.camera.empty': 'La cámara no devolvió nada. Inténtelo de nuevo.',
  'issue.camera.unavailable':
    'La cámara no está disponible. Aun así puede enviar el informe sin foto.',

  'issue.retake': 'Repetir',
  'issue.send': 'Enviar informe',
  'issue.assurance':
    'Su informe llega al mostrador de conserjería y al mensajero de este pedido, en el mismo hilo.',

  // ------------------------------------------------------------------ sign
  'sign.title': 'Firme su entrega',
  'sign.subtitle': 'Compruebe que está todo y firme abajo.',
  'sign.subtitleOne': 'Compruebe que la bolsa está y firme abajo.',
  'sign.subtitleMany': 'Compruebe que están las {count} bolsas y firme abajo.',
  /** Reads as part of the sentence under the signature line — lower case. */
  'sign.you': 'usted',

  'sign.code.label': 'Lea esto a su mensajero',
  'sign.code.hint':
    'Dígalo sólo cuando tenga su ropa en las manos. Al firmar abajo se lo enviamos por usted.',
  'sign.noCode':
    'Este pedido no tiene código de entrega, así que no se puede firmar aquí. El mostrador de conserjería puede completarlo.',
  'sign.refused':
    'Reparto no aceptó eso. Pida al mensajero que lo intente desde su consola.',

  /** The `X` is where the mark goes and stays put in every language. */
  'sign.here': 'X FIRME AQUÍ',
  'sign.notice':
    'Firmar confirma que el número de prendas coincide y cierra el pedido. Cualquier problema posterior aún puede informarse desde la pantalla del pedido.',
  'sign.clear': 'Borrar',
  'sign.confirm': 'Confirmar la entrega',
  'sign.later': 'Todavía no',

  // ---------------------------------------------------------------- wallet
  'wallet.title': 'Cartera',
  'wallet.locked.title': 'Inicie sesión para usar su cartera',
  'wallet.locked.body':
    'Su saldo, sus puntos de fidelidad y su membresía están vinculados a su cuenta, así que le acompañan a cualquier dispositivo desde el que inicie sesión.',

  'wallet.balance.label': 'Saldo disponible',
  'wallet.balance.hint':
    'Liquida una reserva al instante y gana un punto de fidelidad por cedi.',
  'wallet.balance.topUp': 'Recargar',
  'wallet.balance.book': 'Reservar con él',

  'wallet.tier.title': 'Membresía',
  'wallet.tier.caption': 'Se gana con todo lo que gasta.',
  'wallet.tier.lifetime': 'puntos acumulados',
  'wallet.tier.toNext': '{points} puntos para {tier}',
  'wallet.tier.top': 'Nivel máximo: todas las ventajas desbloqueadas.',
  'wallet.tier.benefits': 'Sus ventajas',
  'wallet.tier.discount':
    'Se descuenta un {percent}% de cada presupuesto antes de que lo confirme; nunca tiene que reclamarlo.',

  'wallet.rewards.title': 'Gaste sus puntos',
  'wallet.rewards.redeem': 'Canjear {name} por {cost} puntos de cuidado',
  'wallet.rewards.cost': '{points} pts',
  'wallet.rewards.doneTitle': 'Canjeado',
  'wallet.rewards.doneBody': 'Su recompensa está en su cuenta.',
  'wallet.rewards.failed': 'No se pudo canjear',

  'wallet.plan.title': 'Suscripción',
  'wallet.plan.activeCaption': 'Plan activo',
  'wallet.plan.caption': 'Colada habitual, un precio mensual.',
  'wallet.plan.compare': 'Comparar planes',
  'wallet.plan.meta': 'quedan {left} de {total} recogidas · {when}',
  'wallet.plan.ends': 'termina el {date}',
  'wallet.plan.renews': 'se renueva el {date}',
  'wallet.plan.cancelled':
    'Cancelada. Sus recogidas y su prioridad élite siguen hasta el {date}, y no se cobrará nada más.',
  'wallet.plan.change': 'Cambiar de plan',
  'wallet.plan.keep': 'Mantener el plan',
  /** Short for cancelling the membership. Kept apart from `common.cancel`. */
  'wallet.plan.cancel': 'Dar de baja',
  'wallet.plan.cancelTitle': '¿Dar de baja la membresía?',
  'wallet.plan.cancelBody':
    'Su plan sigue activo hasta el {date} —con las recogidas incluidas y la prioridad élite— y no se cobra nada después. Puede reactivarlo cuando quiera.',
  'wallet.plan.cancelConfirm': 'Dar de baja la membresía',
  'wallet.plan.cancelFailedTitle': 'No se pudo dar de baja',
  'wallet.plan.cancelFailedBody':
    'No se pudo contactar con FreshFold. Su plan sigue igual: inténtelo de nuevo en un momento.',
  'wallet.plan.resumeFailedTitle': 'No se pudo restaurar',
  'wallet.plan.resumeFailedBody':
    'No se pudo contactar con FreshFold. Su plan sigue terminando en la fecha prevista: inténtelo de nuevo en un momento.',
  'wallet.plan.none': 'Sin plan activo',
  'wallet.plan.from': 'Desde {price} al mes, recogidas incluidas.',
  'wallet.plan.explore': 'Ver los planes',

  'wallet.statement.title': 'Movimientos',
  'wallet.statement.caption': 'Todos los movimientos de esta cuenta.',
  'wallet.statement.emptyTitle': 'Nada todavía',
  'wallet.statement.emptyBody':
    'Las recargas, las reservas y los reembolsos aparecen aquí con su referencia.',

  'wallet.topUp.title': 'Recargue su cartera',
  'wallet.topUp.body':
    'Pagado a través de Paystack: MTN MoMo, Telecel Cash, AT Money, Visa o Mastercard. Los fondos llegan en cuanto se liquida el pago.',
  'wallet.topUp.after': 'Saldo tras el pago',
  'wallet.topUp.pay': 'Pagar {amount} con Paystack',
  'wallet.topUp.collect': 'Ya he pagado — recibir fondos',
  'wallet.topUp.finishOnPage':
    'Termine en la página de Paystack y luego toque «Ya he pagado» para recibir los fondos.',
  'wallet.topUp.browserFailed':
    'No se pudo abrir la página de pago aquí. La referencia {reference} está activa: pague en Paystack y luego toque «Ya he pagado».',
  'wallet.topUp.confirmFailed':
    'No se pudo confirmar el pago con FreshFold en {url}. Si se le ha cobrado, su dinero está a salvo: toque «Ya he pagado» de nuevo cuando el servidor sea accesible.',

  'wallet.gateway.unreachable':
    'No se contactó con Paystack: la app no puede llegar a FreshFold en {url}. Compruebe que el servidor de reparto está en marcha y que este dispositivo está en la misma red.',
  'wallet.gateway.timeout':
    'FreshFold no respondió a tiempo. No se cobró nada: inténtelo de nuevo.',
  'wallet.gateway.offline':
    'No se pudo contactar con FreshFold en {url}. Compruebe que el servidor de reparto está en marcha y que este dispositivo lo alcanza.',

  // ------------------------------------------------------------- settings
  'settings.title': 'Ajustes',

  'settings.details.title': 'Sus datos',
  'settings.details.caption': 'Lo que ven el mensajero y el mostrador.',
  'settings.details.name': 'Nombre',
  'settings.details.namePlaceholder': 'Su nombre',
  'settings.details.phone': 'Teléfono',
  'settings.details.phonePlaceholder': '{digits} dígitos — p. ej. 0550001234',
  'settings.details.phoneLength':
    'Un número de teléfono tiene {digits} dígitos, p. ej. 0244000000.',
  'settings.details.email': 'Correo electrónico',
  'settings.details.emailHint':
    'Su correo es su cuenta. El mostrador puede cambiarlo; la app no.',
  'settings.details.nameBlank':
    'Su nombre no puede quedar vacío: el mensajero pregunta por él en la puerta.',
  'settings.details.save': 'Guardar cambios',
  'settings.details.saved': 'Guardado.',
  'settings.details.savedNewPhone':
    'Guardado. Los mensajeros llamarán al nuevo número, y cualquier recogida que reservara como invitado con el anterior dejará de aparecer en su historial.',
  'settings.details.failed':
    'No se pudo contactar con FreshFold, así que no se cambió nada. Revise su conexión e inténtelo de nuevo.',

  'settings.guestCard.title': 'Inicie sesión para cambiar sus datos',
  'settings.guestCard.body':
    'Su nombre, su número y su contraseña viven en la cuenta, y sus direcciones guardadas también: inicie sesión y las de abajo le acompañarán, a la web y a cualquier móvil que use. Los ajustes de avisos pertenecen a este móvil.',

  'settings.security.title': 'Seguridad',
  'settings.security.biometric': 'Bloquear la app',
  'settings.security.biometricOn':
    'Pedir Face ID o su huella al abrir FreshFold, y de nuevo tras un minuto en segundo plano.',
  'settings.security.biometricOff': 'No hay biometría registrada en este dispositivo.',
  'settings.security.reset': 'Enviarme un enlace para restablecer la contraseña',
  'settings.security.resetCaption':
    'El enlace establece una contraseña nueva. Es válido durante una hora.',
  'settings.security.resetSent':
    'Un enlace de restablecimiento va camino de {email}. Es válido durante una hora.',
  'settings.security.assurance':
    'Su contraseña se comprueba en nuestros servidores y nunca se guarda en este dispositivo: sólo se guarda un token de sesión, y al cerrar sesión queda revocado.',

  'settings.addresses.title': 'Direcciones de recogida',
  'settings.addresses.caption':
    'Toque una para que sea la predeterminada que rellena el formulario de reserva.',

  'settings.alerts.title': 'Avisos',
  'settings.alerts.caption':
    'Sólo dentro de la app: FreshFold no envía notificaciones push.',
  'settings.alerts.order': 'Novedades del pedido',
  'settings.alerts.orderCaption': 'Recogido, en el lavado, de vuelta.',
  'settings.alerts.message': 'Mensajes',
  'settings.alerts.messageCaption': 'Respuestas de su mensajero y del mostrador.',
  'settings.alerts.alert': 'Avisos del servicio',
  'settings.alerts.alertCaption':
    'Retrasos, tiempo, cualquier cosa que mueva una recogida.',
  'settings.alerts.assurance':
    'Desactivar uno lo oculta de la campana y deja de contarlo; no borra nada, y al volver a activarlo el historial vuelve con él. Los avisos del mostrador sobre el servicio en sí llegan siempre.',

  'settings.language.title': 'Idioma',
  'settings.language.caption':
    'La app se lee en este idioma. Sus pedidos no se ven afectados.',
  'settings.language.system': 'Seguir a este móvil',
  'settings.language.systemCaption': 'Actualmente {language}.',
  'settings.language.partial': 'Borrador',
  'settings.language.draft':
    '{language} todavía está en revisión: partes de la app siguen en inglés, y el resto es un primer borrador que aún debe revisar un hablante nativo. Cuéntenos qué no suena bien y lo corregiremos.',

  'settings.about.title': 'Acerca de',
  'settings.about.caption': 'Una persona contesta al teléfono.',
  'settings.about.version': 'Versión de la app',
  'settings.about.server': 'Servidor de reparto',
  'settings.about.hours': 'Horario',
  'settings.about.call': 'Llamar al mostrador',
  'settings.about.email': 'Contratos y facturación',

  'settings.danger.title': 'Zona de riesgo',
  'settings.danger.body':
    'Cerrar su cuenta cierra su sesión en todas partes y no se puede deshacer. Sus pedidos dejan de poder leerse aquí, y una cuenta nueva con el mismo correo empieza vacía.',
  'settings.danger.action': 'Eliminar mi cuenta',
  'settings.danger.confirmTitle': '¿Eliminar su cuenta?',
  'settings.danger.confirmBody':
    'Esto cierra {email} para siempre. Su historial de pedidos, sus direcciones guardadas y sus mensajes desaparecen de este móvil, y volver a registrarse con el mismo correo no los recuperará. El mostrador conserva su propio registro del trabajo ya hecho, así que pídanoslo si necesita un recibo de una recogida pasada.',
  'settings.danger.yourAccount': 'su cuenta',
  'settings.danger.wallet':
    'Su cartera todavía tiene {amount}. No se reembolsa: cerrar la cuenta lo pierde. Gástelo antes en una recogida si prefiere no perderlo.',
  'settings.danger.planNamed':
    'Su membresía ({plan}) termina de inmediato, y con ella el resto del periodo que ha pagado.',
  'settings.danger.plan':
    'Su membresía termina de inmediato, y con ella el resto del periodo que ha pagado.',
  'settings.danger.typeToConfirm': 'Escriba {word} para confirmar',
  'settings.danger.keep': 'Conservar mi cuenta',
  'settings.danger.deleting': 'Eliminando…',
  'settings.danger.delete': 'Eliminar definitivamente',
  'settings.danger.failed':
    'No se pudo contactar con FreshFold, así que no se eliminó nada. Revise su conexión e inténtelo de nuevo.',

  // --------------------------------------------------------------- account
  'account.title': 'Cuenta',
  'account.notifications': 'Notificaciones',
  'account.settingsCaption': 'Sus datos, seguridad, direcciones, avisos',

  'account.verify.title': 'Confirme su correo electrónico',
  'account.verify.body':
    'Hemos enviado un enlace a {email}. Confírmelo para empezar a reservar recogidas.',
  'account.verify.resend': 'Reenviar el enlace',
  'account.verify.sent': 'Enviado. Revise su bandeja de entrada y la carpeta de spam.',
  'account.verify.failed': 'No se pudo enviar el enlace. Inténtelo de nuevo en breve.',

  'account.guestName': 'Invitado',
  'account.guestBody':
    'Las reservas funcionan sin cuenta; una cuenta es lo que las conserva, junto con su cartera y su nivel de fidelidad.',

  'account.stats.orders': 'Pedidos',
  'account.stats.points': 'Puntos',
  'account.stats.wallet': 'Cartera',
  'account.stats.spent': 'Gastado',

  'account.orders.title': 'Pedidos recientes',
  'account.orders.caption': '{active} activos · {past} completados',
  'account.orders.seeAll': 'Ver todos',
  'account.orders.emptyTitle': 'Todavía no hay pedidos',
  'account.orders.emptyBody': 'Su primera recogida está a un minuto.',

  'account.addresses.title': 'Direcciones guardadas',
  'account.addresses.caption':
    'Rellena el formulario de reserva. Elija cuál en Ajustes.',

  'account.help.title': 'Ayuda',
  'account.help.caption': 'Una persona, no un formulario.',
  'account.help.foldie': 'Pregunte a Foldie',
  'account.help.foldieCaption': 'Asistente de conserjería, en la app',
  'account.help.rate': 'Valorar FreshFold',
  'account.help.rateCaption': 'Cuéntenos qué tal lo hacemos',
  'account.help.feedbackSubject': 'Comentarios sobre FreshFold',

  'account.signOut': 'Cerrar sesión',
  'account.signOutTitle': '¿Cerrar sesión?',
  'account.signOutBody':
    'Sus pedidos siguen en la cuenta y vuelven cuando inicie sesión.',
  'account.stay': 'Seguir con la sesión abierta',
  'account.build': 'Cliente FreshFold {version} · reparto en {server}',

  // ------------------------------------------------------- address lists
  'addresses.empty': 'Añada su primera dirección',
  'addresses.edit': 'Editar {label}',
  'addresses.remove': 'Eliminar {label}',
  'addresses.confirmRemove': '¿Eliminar esta dirección?',
  'addresses.full':
    'Las direcciones guardadas están limitadas a {max}. Elimine una para añadir otra.',

  // -------------------------------------------------------- address sheet
  'address.add': 'Añadir una dirección',
  'address.edit': 'Editar la dirección',
  'address.label': 'Etiqueta',
  'address.labelPlaceholder': 'Casa, residencia, oficina…',
  'address.address': 'Dirección',
  'address.addressPlaceholder': 'Evandy Hostel, Bloque B, Habitación 304',
  'address.city': 'Ciudad',
  'address.cityPlaceholder': 'Kumasi',
  'address.pinKept':
    'Se conserva el pin que colocó para esta dirección. Editar el texto no lo mueve.',
  'address.pinPlaced':
    'Elegida de la lista, así que esta dirección lleva el pin de ese lugar: escriba el bloque y la habitación a continuación.',
  'address.pinDerived':
    'El mensajero navega hasta un pin deducido de este texto: cuanto más concreto, más cerca llega.',
  'address.zone': 'Zona de recogida',
  'address.zoneHint':
    'No podemos saber dónde está esto sólo por el texto. Elija la zona en la que debemos recoger, o escoja el lugar de la lista de arriba.',
  'address.error.address': 'Escriba la dirección donde debe llamar el mensajero.',
  'address.error.zone':
    'Elija una zona de recogida para que sepamos adónde enviar al mensajero.',
  'address.save': 'Guardar la dirección',
  'address.saveChanges': 'Guardar cambios',
  'address.fallbackLabel': 'Dirección de recogida',

  // ------------------------------------------------------------- app lock
  'lock.title': 'FreshFold está bloqueada',
  'lock.body':
    'Sus pedidos, su cartera y sus direcciones guardadas están tras el bloqueo biométrico que activó en los ajustes.',
  'lock.unlock': 'Desbloquear',
  'lock.retry': 'Reintentar',
  'lock.prompt': 'Desbloquear FreshFold',
  'lock.fallback': 'Usar el código del dispositivo',
  'lock.failed': 'No ha coincidido.',
  'lock.unavailable':
    'Este móvil ya no tiene biometría registrada, así que el bloqueo no puede abrirse aquí. Cerrar sesión mantiene FreshFold utilizable, y sus pedidos siguen en su cuenta.',
  'lock.signOut': 'Cerrar sesión en su lugar',
};
