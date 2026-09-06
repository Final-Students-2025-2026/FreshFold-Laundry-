/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TranslationKey } from './en';

/**
 * French.
 *
 * **Drafted here and not yet read by a native speaker.** It wants one before
 * release. Complete, and the register is deliberately the same slightly plain,
 * unhurried voice the English copy uses rather than the clipped imperative most
 * French UI falls into — `vous` throughout, which is the register the Spanish
 * beside it matches with `usted`.
 *
 * Two choices worth knowing about:
 *
 * - `settings.danger.confirmWord` is absent, so it falls back to `DELETE`. The
 *   word the customer types has to be the word the code compares against, and
 *   translating one half of that pair breaks the gate.
 * - Ghanaian addresses and the desk's own opening hours are not translated
 *   anywhere in the app — they are the same place either way.
 */
export const fr: Partial<Record<TranslationKey, string>> = {
  // -------------------------------------------------------------- shared
  'common.back': 'Retour',
  'common.cancel': 'Annuler',
  'common.keep': 'Garder',
  'common.remove': 'Supprimer',
  'common.add': 'Ajouter',
  'common.close': 'Fermer',
  'common.saving': 'Enregistrement…',
  'common.sending': 'Envoi…',
  'common.default': 'Par défaut',
  'common.signInCta': 'Se connecter ou créer un compte',
  'common.schedulePickup': 'Programmer une collecte',
  'common.unreachable':
    'Impossible de joindre FreshFold. Vérifiez votre connexion et réessayez.',
  'common.offline': 'Hors ligne',
  'common.blank': '—',
  'common.guest': 'Vous naviguez en tant qu’invité',

  // ----------------------------------------------------------------- time
  //
  // « il y a », with the standard abbreviations `min`, `h`, `j`. French keeps a
  // space between the number and its unit.
  'time.justNow': 'à l’instant',
  'time.minutes': 'il y a {count} min',
  'time.hours': 'il y a {count} h',
  'time.days': 'il y a {count} j',

  // -------------------------------------------------------------- courier
  'courier.unnamed': 'Votre coursier',
  'courier.vehiclePending': 'Détails du véhicule à venir',

  // ------------------------------------------------------------------ état
  //
  // `atelier` pour le hub où le linge est traité — « blanchisserie » désigne le
  // commerce, pas l’atelier où passe la commande.
  'status.job.unassigned': 'Non attribué',
  'status.job.assigned': 'Attribué',
  'status.job.navigating_to_pickup': 'En route vers le retrait',
  'status.job.arrived_at_pickup': 'Arrivé au retrait',
  'status.job.pickup_scanned': 'Retrait scanné',
  'status.job.picked_up': 'Récupéré',
  'status.job.navigating_to_laundry': 'En route vers l’atelier',
  'status.job.arrived_at_laundry': 'Arrivé à l’atelier',
  'status.job.dropped_off': 'Déposé',
  'status.job.processing': 'En traitement',
  'status.job.ready_for_delivery': 'Prêt pour la livraison',
  'status.job.navigating_to_delivery': 'En route vers la livraison',
  'status.job.arrived_at_delivery': 'Arrivé à la livraison',
  'status.job.delivered': 'Livré',
  'status.job.cancelled': 'Annulé',

  // `Pris en charge` pour l’étape et `En traitement` pour l’état de répartition :
  // l’anglais dit « In Care » et « processing », et les deux se retrouvent sur le
  // même écran — l’étape au-dessus de la barre, l’état dans la ligne en direct
  // juste en dessous. Deux mots distincts, donc.
  'status.stage.Scheduled': 'Programmé',
  'status.stage.Collecting': 'Collecte',
  'status.stage.In Care': 'Pris en charge',
  'status.stage.Ironing & Folding': 'Repassage et pliage',
  'status.stage.Quality Check': 'Contrôle qualité',
  'status.stage.Delivering': 'Livraison',
  'status.stage.Delivered': 'Livré',
  'status.stage.Cancelled': 'Annulé',

  'status.copy.Scheduled': 'Votre rendez-vous est enregistré. Un coursier sera attribué sous peu.',
  'status.copy.Collecting': 'Votre coursier récupère les sacs et se dirige vers l’atelier.',
  'status.copy.In Care':
    'Réception à l’atelier. Tri et traitement botanique des taches en cours.',
  'status.copy.Ironing & Folding': 'Repassage à la main et pliage soigné en cours.',
  'status.copy.Quality Check':
    'Coutures et finitions inspectées, commande emballée, en attente d’un coursier.',
  'status.copy.Delivering': 'Votre coursier repart vers votre porte avec la commande terminée.',
  'status.copy.Delivered': 'Livré et signé. Merci d’avoir choisi FreshFold.',
  'status.copy.Cancelled': 'Cette commande a été annulée. Rien de plus ne sera collecté.',

  'status.payment.Pending': 'En attente',
  'status.payment.Paid': 'Payé',
  'status.payment.Pay on Pickup': 'Paiement au retrait',
  'status.payment.Refunded': 'Remboursé',

  // ------------------------------------------------------------ accueil
  'home.greeting.morning': 'Bonjour',
  'home.greeting.afternoon': 'Bon après-midi',
  'home.greeting.evening': 'Bonsoir',
  'home.greetingNamed': '{greeting}, {name}',

  'home.live.label': 'En cours',
  'home.live.courier': '{name} · {vehicle}',
  'home.live.assigning': 'Attribution d’un coursier',
  'home.live.track': 'Suivre en direct',
  'home.live.moreOne': '+1 autre commande en cours',
  'home.live.moreMany': '+{count} autres commandes en cours',

  'home.hero.eyebrow': 'FreshFold Laundry Co.',
  // Le retour tombe après « Soin du linge de qualité », là où la phrase se coupe
  // naturellement en français.
  'home.hero.title': 'Le soin du linge,\ncollecté à votre porte.',
  'home.hero.body':
    'Lavage, repassage et traitements spécialisés finis à la main, partout à Kumasi — réservé en une minute, suivi jusqu’au pas de la porte.',
  'home.hero.plans': 'Abonnements',

  'home.quick.book': 'Réserver',
  'home.quick.track': 'Suivre',
  'home.quick.wallet': 'Portefeuille',
  'home.quick.foldie': 'Foldie',

  'home.services.title': 'Nos services',
  'home.services.caption': 'Prix annoncés d’avance. Aucune surprise à la porte.',

  'home.steps.title': 'Comment ça marche',
  'home.steps.caption': 'Quatre étapes, de la porte au placard.',

  'home.why.title': 'Pourquoi FreshFold',
  'home.why.caption': 'Ce qu’une laverie ne vous donne pas.',

  'home.segments.title': 'Pensé pour',
  'home.segments.caption': 'Touchez-en un pour lancer une réservation à sa mesure.',


  'home.contact.title': 'Parlez-nous',
  'home.contact.caption': 'Une personne, pas un formulaire.',
  'home.contact.phoneCaption': 'Appeler le bureau du concierge',
  'home.contact.foldie': 'Demander à Foldie',
  'home.contact.foldieCaption': 'Notre assistant concierge, dans l’application',
  'home.contact.emailCaption': 'Pour les contrats et la facturation',
  'home.contact.addressCaption': 'Là où vos vêtements sont soignés',
  'home.contact.hoursCaption': 'Les collectes vont jusqu’à la fermeture',

  'home.footer':
    'FreshFold Laundry Co. · Ayeduase-Kotei, Kumasi\nChaque commande est chiffrée avant que vous confirmiez.',

  // ---------------------------------------------------------- réservation
  'book.title': 'Programmer une collecte',
  'book.stepOf': 'Étape {current} sur {total} · {name}',
  'book.step.service': 'Service',
  'book.step.schedule': 'Horaire',
  'book.step.address': 'Adresse',
  'book.step.finishing': 'Finition',
  'book.step.payment': 'Paiement',

  'book.service.prompt': 'Qu’y a-t-il à soigner ?',
  'book.service.helper':
    'Touchez pour changer. Chaque service est chiffré avant que vous confirmiez, et la collecte est offerte sur tous.',
  'book.picker.service': 'Choisir un service',
  'service.priceFrom': 'À partir de {amount} / {unit}',
  'book.extra.add': '+ Ajouter un autre service',
  'book.extra.change': 'Changer de service',
  'book.extra.remove': 'Retirer ce service',

  // « de {unit} » plutôt que « Combien de… ? » : l’unité arrive à l’exécution et
  // son genre ne peut pas être accordé d’avance.
  'book.quantity.title': 'Nombre de {unit}',
  'book.quantity.each': '{amount} par {unit}',
  'book.quantity.fewer': 'Diminuer la quantité',
  'book.quantity.more': 'Augmenter la quantité',

  // ---------------------------------------------------------------- unités
  // « machine » est le mot courant pour une charge de linge ; « parure » pour
  // un ensemble de draps.
  'unit.load.one': 'machine',
  'unit.load.many': 'machines',
  'unit.set.one': 'parure',
  'unit.set.many': 'parures',
  'unit.ride.one': 'véhicule',
  'unit.ride.many': 'véhicules',
  'unit.space.one': 'espace',
  'unit.space.many': 'espaces',
  'unit.unit.one': 'pièce',
  'unit.unit.many': 'pièces',
  'unit.order.one': 'commande',
  'unit.order.many': 'commandes',

  'book.plan.coveredTitle': 'Cette collecte est incluse dans votre abonnement',
  'book.plan.title': 'Réservé au titre de votre abonnement',
  // « reste {left} sur {total} collectes » plutôt que « {left} collectes
  // restantes », pour que la phrase tienne aussi quand il n’en reste qu’une.
  'book.plan.coveredBody':
    'Le lavage est déjà payé — reste {left} sur {total} collectes ce mois-ci. Les options sont facturées à votre tarif abonné, et la commande est prioritaire en répartition.',
  'book.plan.rateBody':
    'Vos collectes incluses sont épuisées pour ce mois, donc celle-ci passe à votre tarif abonné. Elle reste prioritaire en répartition, et votre quota se renouvelle le {date}.',
  'book.plan.priorityBody': 'Cette commande est prioritaire en répartition.',

  'book.date.title': 'Date de collecte',
  // Abrégés pour tenir dans une rangée de cinq cellules.
  'book.date.today': 'Auj.',
  'book.date.tomorrow': 'Dem.',
  'book.date.field': 'Ou saisissez une date',
  'book.date.placeholder': 'AAAA-MM-JJ',
  'book.date.hint': 'La livraison est prévue pour le lendemain.',
  'book.return.title': 'Créneau de retour',
  'book.return.day': 'De retour le {date}',
  'book.return.tooEarly': 'Trop tôt — votre linge ne serait pas encore revenu',

  'standing.title': 'Commandes permanentes',
  'standing.subtitle': 'Les collectes hebdomadaires que votre abonnement paie déjà.',
  'standing.yours': 'Vos commandes permanentes',
  'standing.none': 'Aucune pour l’instant. Créez-en une ci-dessous et nous la réserverons chaque semaine.',
  'standing.add': 'Ajouter une collecte hebdomadaire',
  'standing.create': 'Créer la commande permanente',
  'standing.collectFrom': 'Collectée à {address}.',
  'standing.needAddress': 'Enregistrez d’abord une adresse — une commande permanente a besoin d’un lieu de collecte.',
  'standing.failed': 'Enregistrement impossible. Réessayez.',
  'standing.paused': 'En pause',
  'standing.lastBooked': 'dernière réservation pour le {date}',
  'standing.notYetBooked': 'pas encore réservée',
  'standing.remove.title': 'Arrêter cette commande permanente ?',
  'standing.remove.body': 'Les réservations déjà faites ne changent pas. Rien de plus ne sera réservé.',
  'standing.signedOut.title': 'Connectez-vous pour les commandes permanentes',
  'standing.signedOut.body': 'Les collectes hebdomadaires sont liées à votre compte, pour savoir où venir et quoi rapporter.',
  'standing.referral.title': 'Parrainez un ami',
  'standing.referral.blurb': 'Il obtient {welcome} sur sa première commande. Vous recevez {reward} à la livraison.',
  'standing.referral.count': '{invited} parrainés · {rewarded} récompensés',
  'standing.referral.pending': 'Votre code apparaîtra ici dans un instant.',
  'standing.referral.claimLabel': 'Vous avez le code d’un ami ?',
  'standing.referral.claim': 'Utiliser ce code',
  'standing.referral.failed': 'Ce code n’a pas pu être utilisé.',

  'book.promo.title': 'Code promo ou de parrainage',
  'book.promo.placeholder': 'FRESHERS24',
  'book.promo.apply': 'Appliquer',
  'book.promo.checking': 'Vérification…',
  'book.promo.applied': '{code} appliqué — {amount} de réduction.',
  'book.promo.unreachable': 'Impossible de vérifier ce code. Vous pouvez réserver sans lui.',
  'book.summary.promo': 'Code {code}',
  'book.summary.taxIncluded': 'Taxes comprises',

  'book.window.title': 'Créneau de collecte',
  'book.window.full': 'Complet — choisissez un autre créneau',
  'book.window.remaining': 'Plus que {count} dans ce créneau',

  'book.address.saved': 'Utiliser une adresse enregistrée',
  'book.picker.addresses': 'Adresses enregistrées',
  'book.address.hint': 'Indiquez le bloc et la chambre — c’est ce que le coursier lit à la porte.',
  'book.address.save': 'Enregistrer cette adresse pour la prochaine fois',

  'book.pin.title': 'Où le coursier doit-il frapper ?',
  'book.pin.intro':
    'Une adresse est une phrase ; un coursier a besoin d’un point. Placez le repère sur votre portail ou l’entrée du foyer — c’est ce que suit sa navigation et ce qui confirme son arrivée.',

  'book.contact.title': 'Qui le coursier doit-il demander ?',
  'book.contact.name': 'Nom complet',
  'book.contact.namePlaceholder': 'Ama Mensah',
  'book.contact.emailPlaceholder': 'vous@exemple.com',
  'book.contact.emailHint':
    'Facultatif — mais c’est ce qui nous permettra de rattacher cette commande à un compte plus tard.',

  'book.scent.title': 'Parfum',
  'book.scent.noSurcharge': 'Sans supplément',
  'book.starch.title': 'Amidon sur le repassage',
  'book.finish.noneTitle': 'Pas d’options de finition ici',
  'book.finish.noneBody':
    'Le parfum et l’amidon concernent les vêtements. {service} est chiffré sur le travail lui-même — ajoutez une note ci-dessous s’il y a quelque chose de précis.',
  'book.addons.title': 'Options spécialisées',
  'book.instructions.label': 'Consignes d’entretien',
  'book.instructions.placeholder':
    'Le blazer bleu marine a une tache de café sur le poignet gauche.',
  'book.riderNote.label': 'Note pour le coursier',
  'book.riderNote.placeholder': 'Appelez en arrivant au portail — la sonnette est cassée.',
  'book.riderNote.hint': 'Affiché sur la fiche du coursier, pas pour l’équipe de blanchisserie.',

  'book.summary.title': 'Récapitulatif',
  'book.summary.service': 'Service',
  'book.summary.pickup': 'Collecte',
  'book.summary.address': 'Adresse',
  'book.summary.pin': 'Repère de collecte',
  'book.summary.pinUnset': 'Non placé',
  'book.summary.finish': 'Finition',
  'book.summary.finishValue': '{scent}, amidon {starch}',
  'book.summary.addons': 'Options',
  'book.summary.subtotal': 'Sous-total',
  'book.summary.planIncluded': '{plan} — collecte incluse',
  'book.summary.planFallback': 'Abonnement',
  'book.summary.memberRate': 'Tarif abonné',
  'book.summary.tierDiscount': 'Remise {tier}',
  'book.summary.total': 'Total',
  'book.summary.less': '− {amount}',

  'book.pay.title': 'Comment souhaitez-vous payer ?',
  'book.pay.walletBalance': 'Solde {amount}',
  'book.pay.walletShort': 'Solde {amount} — insuffisant',
  'book.pay.paystackTitle': 'Paiement sécurisé Paystack',
  'book.pay.paystackBody':
    'Ouvre Paystack dans un navigateur. Aucune donnée de votre carte n’est saisie dans cette application ni conservée par FreshFold.',
  'book.pay.open': 'Ouvrir le paiement',
  'book.pay.reopen': 'Réouvrir le paiement',
  'book.pay.verify': 'J’ai payé — vérifier',
  'book.pay.doorTitle': 'Régler à la porte',
  'book.pay.doorBody':
    'Le coursier porte un terminal de carte et accepte le mobile money. Votre commande est confirmée dans les deux cas.',
  // {message} arrive en anglais de la passerelle ou du serveur : le cadre est
  // traduit, la phrase citée ne l’est pas.
  'book.pay.gateway': 'Passerelle de paiement : {message}',
  'book.pay.gatewayUnreachable':
    'Impossible de joindre la passerelle de paiement. Vérifiez votre connexion, ou choisissez le paiement à la collecte.',
  'book.pay.finishOnPage':
    'Terminez sur la page Paystack, puis touchez « J’ai payé » pour vérifier.',
  'book.pay.browserFailed':
    'Impossible d’ouvrir la page de paiement ici. La référence {reference} est active — ouvrez Paystack, payez, puis touchez « J’ai payé ».',
  'book.pay.confirmed': 'Paiement confirmé.',
  'book.pay.pending': 'Paystack indique : {status}. Terminez le paiement et réessayez.',
  'book.pay.pendingStatus': 'en attente',
  'book.pay.verifyUnreachable':
    'Impossible de joindre FreshFold pour confirmer le paiement. Si vous avez été débité, votre argent est en sécurité — touchez « J’ai payé » de nouveau dans un instant.',
  'book.pay.bookedThen': 'Collecte réservée. {message}',
  'book.pay.bookedUnsettled':
    'Collecte réservée, mais nous n’avons pas pu prendre le paiement. Réglez-la depuis votre portefeuille.',

  'book.error.date': 'Choisissez une date de collecte.',
  'book.error.address': 'Il nous faut une adresse où collecter.',
  'book.error.pin': 'Placez le repère de collecte pour que le coursier sache où frapper.',
  'book.error.name': 'Dites-nous qui demander à la porte.',
  'book.error.phone': 'Un numéro de téléphone permet au coursier de vous joindre.',
  'book.error.paystackEmail':
    'Ajoutez votre adresse e-mail pour payer en ligne — Paystack y envoie le reçu.',
  'book.error.walletSignIn': 'Connectez-vous pour payer depuis votre portefeuille FreshFold.',
  'book.error.walletShort':
    'Votre portefeuille contient {amount}. Choisissez un autre moyen ou rechargez-le.',
  'book.error.save':
    'Impossible d’enregistrer cette réservation. Elle est en file d’attente et partira dès que vous serez reconnecté.',

  'book.quote.due': 'Total à payer',
  'book.quote.running': 'Devis en cours',
  // Le possessif est passé dans {reason} : « vos tarifs » est pluriel quand les
  // deux remises s’appliquent, et le cadre ne peut pas s’accorder tout seul.
  'book.quote.before': '{amount} avant {reason}',
  'book.quote.reasonIncluded': 'votre collecte incluse',
  'book.quote.reasonBoth': 'vos tarifs abonné et de palier',
  'book.quote.reasonMember': 'votre tarif abonné',
  'book.quote.reasonTier': 'votre remise de palier',
  'book.continue': 'Continuer',
  'book.confirm': 'Confirmer la réservation',

  'book.done.title': 'Réservé',
  'book.done.bodyBefore': 'La référence',
  'book.done.bodyAfter':
    'est sur le tableau de répartition. Un coursier l’acceptera sous peu et vous pourrez le suivre depuis l’onglet Suivi.',
  'book.done.collection': 'Collecte',
  'book.done.return': 'Retour',
  'book.done.paid': 'Payé',
  'book.done.another': 'Réserver à nouveau',
  'book.done.track': 'Suivre',

  // ------------------------------------------------------------------ suivi
  'track.title': 'Suivi',

  'track.empty.title': 'Rien en cours',
  'track.empty.body':
    'Dès que vous réservez une collecte, la progression du coursier s’affiche ici en temps réel.',

  'track.pending.title': 'Attribution d’un coursier',
  'track.pending.body':
    'Votre réservation est sur le tableau de répartition. Dès qu’un coursier l’accepte, sa position et ses coordonnées apparaissent ici.',

  'track.section.door': 'À la porte',
  'track.section.order': 'Cette commande',

  'track.action.scan': 'Vérifier les sacs',
  'track.action.scanCaption': 'Scannez le manifeste vous-même',
  'track.action.issue': 'Signaler un problème',
  'track.action.issueCaption': 'Photographiez un vêtement',
  'track.action.chat': 'Conversation',
  'track.action.chatCaption': 'Écrire à la répartition',
  'track.action.chatOne': '1 message',
  'track.action.chatMany': '{count} messages',
  'track.action.full': 'Commande complète',
  'track.action.fullCaption': 'Manifeste, preuve, reçu',

  'track.row.payment': 'Paiement',
  'track.row.paymentValue': '{status} · {method}',
  'track.row.collectionValue': '{date} · {time}',
  'track.open': 'Ouvrir la commande',

  'track.call': 'Appeler le coursier',
  'track.message': 'Écrire au coursier',

  // « Répartition » est le mot employé partout ailleurs dans ce fichier pour le
  // tableau de dispatch ; l’état arrive déjà traduit par `status.job.*`.
  'track.dispatch': 'Répartition : {status}',

  // -------------------------------------------------------------- remise
  'handoff.label': 'Code de collecte',
  'handoff.atDoor': 'Votre coursier est à la porte',
  'handoff.waiting': 'À montrer à l’arrivée du coursier',
  'handoff.body':
    'Votre coursier scannera le code ou demandera les quatre chiffres. Ne confiez les sacs à personne qui ne peut pas le vérifier.',
  'handoff.hide': 'Masquer',
  'handoff.hideLabel': 'Masquer le code de collecte',
  'handoff.show': 'Afficher à nouveau le QR et le code',
  'handoff.showLabel': 'Afficher le code de collecte',
  'handoff.tied':
    'Le code est lié à la commande {id} et ne fonctionne que pour cette collecte.',

  // -------------------------------------------------------------- carte
  'map.home': 'Votre adresse',
  'map.recenter': 'Recentrer la carte sur votre coursier',
  // « à 8 min » est ce qu’on dit ; « 8 min de distance » ne se dit pas.
  'map.eta': 'à {minutes} min',
  'map.noPin': 'Cette réservation n’a pas encore de point de retrait.',
  // {message} est l’erreur de la vue native, laissée en anglais telle qu’elle
  // arrive.
  'map.failed':
    'La carte n’a pas pu être chargée sur cet appareil ({message}). Les positions restent en direct ci-dessous.',
  'map.readout': 'Relevé des positions',
  'map.webNotice':
    'Les tuiles en direct s’affichent sur iOS et Android. Ouvrez l’application sur un téléphone pour voir la carte.',
  'map.expoNotice':
    'Les tuiles en direct s’affichent sur iOS et Android. Ouvrez l’application dans Expo Go pour voir la carte.',
  'map.hubDetail': 'Là où vos vêtements sont traités',
  'map.noPinYet': 'Pas encore de point',

  // ------------------------------------------------------------- la commande
  'order.title': 'Commande',
  'order.missing.title': 'Commande introuvable',
  'order.missing.body':
    'Cette référence n’est pas dans votre historique. Si vous avez réservé sur le site, connectez-vous avec la même adresse e-mail pour la voir ici.',

  'order.claims.title': 'Problèmes que vous avez signalés',
  'order.claims.status.open': 'Signalé',
  'order.claims.status.investigating': 'À l’étude',
  'order.claims.status.upheld': 'Accepté — nous vous devons',
  'order.claims.status.rejected': 'Non retenu',
  'order.claims.status.resolved': 'Réglé',
  'order.claims.credited': '{amount} crédités sur votre portefeuille.',
  'order.claims.retreatment': 'Nous le retraiterons à nos frais.',

  'order.reschedule.action': 'Déplacer cette collecte',
  'order.reschedule.title': 'Déplacer cette collecte',
  'order.reschedule.date': 'Nouvelle date de collecte',
  'order.reschedule.confirm': 'Déplacer la collecte',
  'order.reschedule.movesLeft': 'Vous pouvez encore déplacer cette réservation {count} fois.',
  'order.reschedule.lastMove':
    'C’est la dernière fois que cette réservation peut être déplacée. Ensuite, annulez et réservez à nouveau.',
  'order.reschedule.failed': 'Le déplacement a échoué. Réessayez.',

  'order.cancel.action': 'Annuler cette commande',
  'order.cancel.title': 'Annuler cette commande ?',
  'order.cancel.body':
    'Le coursier sera rappelé. Toute somme déjà payée est recréditée sur votre portefeuille par le service conciergerie.',
  // « Garder » seul répond à la question ; l’anglais ajoute « it » parce que sa
  // grammaire le réclame, le français non.
  'order.cancel.keep': 'Garder',
  'order.cancel.confirm': 'Annuler',
  'order.cancel.failed': "L'annulation n'a pas abouti pour le moment. Réessayez.",

  'order.section.actions': 'Ce que vous pouvez faire',
  'order.section.manifest': 'Contenu des sacs',
  'order.section.details': 'Détails',
  'order.section.proof': 'Preuve de service',

  'order.sign.title': 'Signer la livraison',
  'order.sign.captionCode':
    'Votre coursier est à la porte. Communiquez-lui le code {code}.',
  'order.sign.caption': 'Votre coursier est à la porte.',

  'order.scan.title': 'Vérifier le contenu des sacs',
  'order.scan.checked': '{count} sur {total} vérifiés par vous',
  'order.scan.bagsOne': '1 sac sur cette commande',
  'order.scan.bagsMany': '{count} sacs sur cette commande',

  'order.issue.caption': 'Photographiez un vêtement et dites-nous ce qui s’est passé',
  'order.chat.caption': 'Écrire au coursier ou à la répartition',

  'order.call.title': 'Appeler la conciergerie',
  // « Au sujet de » plutôt que « À propos de » : on appelle au sujet d’une
  // course, « à propos » introduit un thème.
  'order.call.caption': 'Au sujet de {name} · {vehicle}',

  'order.manifest.verified': '{count}/{total} vérifiés par vous',
  'order.bag.meta': '{code} · {items} articles · {weight}',
  'order.bag.metaNoWeight': '{code} · {items} articles',
  'order.bag.uncounted': '{code} · compté à l’arrivée à l’atelier',

  'order.row.booked': 'Réservée',
  'order.row.plan': 'Abonnement',
  'order.row.quantity': 'Quantité',
  'order.row.care': 'Consignes d’entretien',
  'order.row.courierNote': 'Note du coursier',
  'order.row.courier': 'Coursier',
  'order.row.courierValue': '{name} · {status}',

  // Le participe s’accorde avec ce qui est photographié : un vêtement collecté,
  // une signature apposée. « Collecté » au masculin pour le linge en général.
  'order.proof.pickupPhoto': 'Collecté',
  'order.proof.pickupSignature': 'Signé à la collecte',
  'order.proof.deliveryPhoto': 'Livré',
  'order.proof.deliverySignature': 'Signé à la livraison',
  'order.proof.vector': 'Signature enregistrée',

  'order.receipt.open': 'Voir le reçu',
  // Ligne de reçu, donc une date : « Collecte le … », d’où le nom de l’étape et
  // non le participe utilisé sous les photos.
  'order.receipt.collected': 'Collecte',
  'order.receipt.returned': 'Retour',
  'order.receipt.method': 'Moyen de paiement',
  'order.receipt.status': 'Statut',
  'order.receipt.reference': 'Référence',

  'order.again': 'Réserver à nouveau',
  'order.rate.title': 'Comment cela s’est-il passé ?',
  'order.rate.prompt': 'Notez {name} — un seul geste, et le bureau les lit toutes.',
  'order.rate.thanks': 'Merci. Votre note est arrivée au bureau.',
  'order.rate.star': '{count} sur 5',

  // ------------------------------------------------------------ le scanneur
  'scanner.title': 'Vérifiez vos sacs',
  'scanner.mode.checklist': 'Liste',
  'scanner.mode.camera': 'Scanner à la caméra',

  'scanner.hint.initial':
    'Placez une étiquette de sac dans le cadre, ou cochez-les à la main.',
  'scanner.hint.checked': '{code} coché.',
  'scanner.hint.all': 'Tous les sacs sont là.',
  'scanner.hint.verified': '{code} vérifié — {type}.',
  'scanner.hint.foreign': '« {code} » ne fait pas partie de {reference}.',
  'scanner.hint.declined':
    'Accès à la caméra refusé — cochez les sacs à la main à la place.',
  'scanner.hint.live':
    'Caméra activée. Alignez une étiquette de sac FreshFold dans le cadre.',

  'scanner.empty.title': 'Chaque sac porte un code imprimé',
  'scanner.empty.body':
    'Scannez-les au départ, ou au retour, et gardez votre propre compte.',

  'scanner.manifest': 'Contenu ({count}/{total})',
  'scanner.tickAll': 'Tout cocher',
  'scanner.bag.meta': '{code} · {items} articles',
  'scanner.checked': 'Coché',
  'scanner.tick': 'Cocher',
  'scanner.confirmNone': 'Cochez d’abord un sac',
  'scanner.confirmOne': 'Confirmer 1 sac',
  'scanner.confirmMany': 'Confirmer {count} sacs',

  // ------------------------------------------------------------- le problème
  'issue.title': 'Signaler un problème',
  'issue.subtitle':
    'Tout ce qui ne va pas est retraité à nos frais — dites-nous ce qui s’est passé.',

  // Les cinq motifs sont aussi le texte envoyé : ils sont rédigés à la première
  // personne, comme les écrirait la personne qui les choisit.
  'issue.reason.stain': 'Un vêtement est revenu avec une tache',
  'issue.reason.missing': 'Il manque quelque chose dans le sac',
  'issue.reason.damaged': 'Un vêtement a été abîmé',
  'issue.reason.finish': 'La finition n’est pas celle que j’ai demandée',
  'issue.reason.late': 'La commande est arrivée en retard',

  'issue.field': 'Que s’est-il passé ?',
  'issue.placeholder':
    'Le blazer bleu marine a une marque sur le poignet gauche, elle était là au retour.',

  'issue.camera.take': 'Prendre une photo',
  'issue.camera.title': 'Ajoutez une photo',
  'issue.camera.body':
    'Une photo règle la plupart des cas en un message — facultatif, mais ça aide.',
  'issue.camera.enable': 'Activer la caméra',
  'issue.camera.empty': 'La caméra n’a rien renvoyé. Réessayez.',
  'issue.camera.unavailable':
    'La caméra est indisponible. Vous pouvez tout de même envoyer le signalement sans photo.',

  'issue.retake': 'Reprendre',
  'issue.send': 'Envoyer le signalement',
  'issue.assurance':
    'Votre signalement part à la conciergerie et au coursier de cette course, dans le même fil.',

  // ------------------------------------------------------------- la signature
  'sign.title': 'Signez votre livraison',
  'sign.subtitle': 'Vérifiez que tout est là, puis signez ci-dessous.',
  'sign.subtitleOne': 'Vérifiez que le sac est là, puis signez ci-dessous.',
  'sign.subtitleMany': 'Vérifiez que les {count} sacs sont là, puis signez ci-dessous.',
  'sign.you': 'vous',

  'sign.code.label': 'Lisez ceci à votre coursier',
  'sign.code.hint':
    'Ne le donnez qu’une fois votre linge réellement entre vos mains. Signer ci-dessous l’envoie pour vous.',
  'sign.noCode':
    "Cette commande n'a pas de code de livraison ; elle ne peut donc pas être signée ici. Le service conciergerie peut la finaliser.",
  'sign.refused':
    'La répartition n’a pas accepté. Demandez au coursier d’essayer depuis sa console.',

  // Le « X » marque l’endroit et ne se traduit pas.
  'sign.here': 'X SIGNEZ ICI',
  'sign.notice':
    'Signer confirme que le compte des vêtements correspond et clôt la commande. Tout problème constaté ensuite peut encore être signalé depuis l’écran de la commande.',
  'sign.clear': 'Effacer',
  'sign.confirm': 'Confirmer la livraison',
  'sign.later': 'Pas encore',

  // ---------------------------------------------------------- portefeuille
  'wallet.title': 'Portefeuille',
  'wallet.locked.title': 'Connectez-vous pour utiliser votre portefeuille',
  'wallet.locked.body':
    'Votre solde, vos points de fidélité et votre abonnement sont liés à votre compte : ils vous suivent sur tout appareil où vous vous connectez.',

  'wallet.balance.label': 'Solde disponible',
  'wallet.balance.hint':
    'Règle une réservation instantanément et rapporte un point de fidélité par cedi.',
  'wallet.balance.topUp': 'Recharger',
  // « Réserver avec » ne tient pas seul en français ; le bouton dit ce qu’il
  // utilise.
  'wallet.balance.book': 'Utiliser le solde',

  // `Statut de membre` pour la fidélité, `Abonnement` pour la formule payante :
  // l’anglais dit « Membership » et « Subscription », et les confondre ici
  // donnerait deux sections du même nom sur un même écran.
  'wallet.tier.title': 'Statut de membre',
  'wallet.tier.caption': 'Gagné sur tout ce que vous dépensez.',
  'wallet.tier.lifetime': 'points cumulés',
  'wallet.tier.toNext': '{points} points jusqu’à {tier}',
  'wallet.tier.top': 'Niveau maximal — tous les avantages débloqués.',
  'wallet.tier.benefits': 'Vos avantages',
  'wallet.tier.discount':
    '{percent} % est déduit de chaque devis avant votre confirmation — vous n’avez rien à réclamer.',

  'wallet.rewards.title': 'Dépenser vos points',
  'wallet.rewards.redeem': 'Échanger {name} contre {cost} points de fidélité',
  'wallet.rewards.cost': '{points} pts',
  'wallet.rewards.doneTitle': 'Échangé',
  'wallet.rewards.doneBody': 'Votre récompense est sur votre compte.',
  'wallet.rewards.failed': 'Échange impossible',

  'wallet.plan.title': 'Abonnement',
  'wallet.plan.activeCaption': 'Formule active',
  'wallet.plan.caption': 'Du linge régulier, un prix mensuel.',
  'wallet.plan.compare': 'Comparer les formules',
  'wallet.plan.meta': '{left} collectes sur {total} restantes · {when}',
  'wallet.plan.ends': 'se termine le {date}',
  'wallet.plan.renews': 'se renouvelle le {date}',
  'wallet.plan.cancelled':
    'Annulé. Vos collectes et votre priorité courent jusqu’au {date} — rien de plus ne sera prélevé.',
  'wallet.plan.change': 'Changer de formule',
  'wallet.plan.keep': 'Garder la formule',
  'wallet.plan.cancel': 'Annuler',
  'wallet.plan.cancelTitle': 'Annuler l’abonnement ?',
  'wallet.plan.cancelBody':
    'Votre formule reste active jusqu’au {date} — collectes incluses et priorité comprise — et rien n’est prélevé ensuite. Vous pouvez la reprendre à tout moment.',
  'wallet.plan.cancelConfirm': 'Annuler l’abonnement',
  'wallet.plan.cancelFailedTitle': 'Annulation impossible',
  'wallet.plan.cancelFailedBody':
    'Impossible de joindre FreshFold. Votre formule est inchangée — réessayez dans un instant.',
  'wallet.plan.resumeFailedTitle': 'Rétablissement impossible',
  'wallet.plan.resumeFailedBody':
    'Impossible de joindre FreshFold. Votre formule se termine toujours comme prévu — réessayez dans un instant.',
  'wallet.plan.none': 'Aucune formule active',
  'wallet.plan.from': 'À partir de {price} par mois, collectes incluses.',
  'wallet.plan.explore': 'Découvrir les formules',

  'wallet.statement.title': 'Relevé',
  'wallet.statement.caption': 'Chaque mouvement sur ce compte.',
  'wallet.statement.emptyTitle': 'Rien pour l’instant',
  'wallet.statement.emptyBody':
    'Recharges, réservations et remboursements apparaissent ici avec leur référence.',

  'wallet.topUp.title': 'Recharger votre portefeuille',
  'wallet.topUp.body':
    'Payé via Paystack — MTN MoMo, Telecel Cash, AT Money, Visa ou Mastercard. Les fonds arrivent dès que le paiement est encaissé.',
  'wallet.topUp.after': 'Solde après paiement',
  'wallet.topUp.pay': 'Payer {amount} avec Paystack',
  'wallet.topUp.collect': 'J’ai payé — encaisser',
  'wallet.topUp.finishOnPage':
    'Terminez sur la page Paystack, puis touchez « J’ai payé » pour encaisser les fonds.',
  'wallet.topUp.browserFailed':
    'Impossible d’ouvrir la page de paiement ici. La référence {reference} est active — payez sur Paystack, puis touchez « J’ai payé ».',
  'wallet.topUp.confirmFailed':
    'Impossible de confirmer le paiement auprès de FreshFold à {url}. Si vous avez été débité, votre argent est en sécurité — touchez « J’ai payé » de nouveau dès que le serveur est joignable.',
  // `serveur de répartition` est le nom donné au serveur dans les réglages ;
  // {url} est son adresse, laissée telle quelle.
  'wallet.gateway.unreachable':
    'Paystack n’a pas été contacté — l’application ne peut pas joindre FreshFold à {url}. Vérifiez que le serveur de répartition tourne et que cet appareil est sur le même réseau.',
  'wallet.gateway.timeout':
    'FreshFold n’a pas répondu à temps. Rien n’a été débité — réessayez.',
  'wallet.gateway.offline':
    'Impossible de joindre FreshFold à {url}. Vérifiez que le serveur de répartition tourne et que cet appareil peut le voir.',

  // ------------------------------------------------------------- settings
  'settings.title': 'Réglages',

  'settings.details.title': 'Vos informations',
  'settings.details.caption': 'Ce que voient le coursier et le bureau.',
  'settings.details.name': 'Nom',
  'settings.details.namePlaceholder': 'Votre nom',
  'settings.details.phone': 'Téléphone',
  'settings.details.phonePlaceholder': '{digits} chiffres — par ex. 0550001234',
  'settings.details.phoneLength':
    'Un numéro de téléphone compte {digits} chiffres, par ex. 0244000000.',
  'settings.details.email': 'E-mail',
  'settings.details.emailHint':
    'Votre e-mail est votre compte. Le bureau peut le changer — l’application non.',
  'settings.details.nameBlank':
    'Votre nom ne peut pas rester vide — le coursier le demande à la porte.',
  'settings.details.save': 'Enregistrer les modifications',
  'settings.details.saved': 'Enregistré.',
  'settings.details.savedNewPhone':
    'Enregistré. Les coursiers appelleront le nouveau numéro — et toute collecte réservée en tant qu’invité avec l’ancien disparaîtra de votre historique.',
  'settings.details.failed':
    'Impossible de joindre FreshFold : rien n’a été modifié. Vérifiez votre connexion et réessayez.',

  'settings.guestCard.title': 'Connectez-vous pour modifier vos informations',
  'settings.guestCard.body':
    'Votre nom, votre numéro et votre mot de passe appartiennent au compte, comme vos adresses enregistrées : connectez-vous et celles ci-dessous vous suivent, sur le site comme sur tout téléphone que vous utilisez. Les réglages d’alertes appartiennent à ce téléphone.',

  'settings.security.title': 'Sécurité',
  'settings.security.biometric': 'Verrouiller l’application',
  'settings.security.biometricOn':
    'Demander Face ID ou votre empreinte à l’ouverture de FreshFold, puis à nouveau après une minute en arrière-plan.',
  'settings.security.biometricOff': 'Aucune biométrie enregistrée sur cet appareil.',
  'settings.security.reset': 'M’envoyer un lien de réinitialisation',
  'settings.security.resetCaption':
    'Le lien définit un nouveau mot de passe. Il est valable une heure.',
  'settings.security.resetSent':
    'Un lien de réinitialisation part vers {email}. Il est valable une heure.',
  'settings.security.assurance':
    'Votre mot de passe est vérifié sur nos serveurs et n’est jamais conservé sur cet appareil — seul un jeton de session l’est, et la déconnexion le révoque.',

  'settings.addresses.title': 'Adresses de collecte',
  'settings.addresses.caption':
    'Touchez-en une pour qu’elle devienne celle que le formulaire remplit d’office.',

  'settings.alerts.title': 'Alertes',
  'settings.alerts.caption':
    'Dans l’application uniquement — FreshFold n’envoie pas de notifications push.',
  'settings.alerts.order': 'Suivi des commandes',
  'settings.alerts.orderCaption': 'Collectée, en cours de lavage, en route vers vous.',
  'settings.alerts.message': 'Messages',
  'settings.alerts.messageCaption': 'Les réponses de votre coursier et du bureau.',
  'settings.alerts.alert': 'Alertes de service',
  'settings.alerts.alertCaption': 'Retards, météo, tout ce qui déplace une collecte.',
  'settings.alerts.assurance':
    'En désactiver une la masque dans la cloche et l’exclut du compteur — rien n’est supprimé, et la réactiver ramène l’historique avec elle. Les avis du bureau sur le service lui-même passent toujours.',

  'settings.language.title': 'Langue',
  'settings.language.caption':
    'L’application s’affiche dans cette langue. Vos commandes n’en sont pas affectées.',
  'settings.language.system': 'Suivre ce téléphone',
  'settings.language.systemCaption': 'Actuellement {language}.',
  'settings.language.partial': 'Ébauche',
  'settings.language.draft':
    'Le {language} est en cours : une partie de l’application reste en anglais, et le reste est une première version qu’un locuteur natif doit encore relire. Dites-nous ce qui sonne faux et nous le corrigerons.',

  'settings.about.title': 'À propos',
  'settings.about.caption': 'Une personne répond au téléphone.',
  'settings.about.version': 'Version de l’application',
  'settings.about.server': 'Serveur de répartition',
  'settings.about.hours': 'Heures d’ouverture',
  'settings.about.call': 'Appeler le bureau',
  'settings.about.email': 'Contrats et facturation',

  'settings.danger.title': 'Zone sensible',
  'settings.danger.body':
    'Fermer votre compte vous déconnecte partout et ne peut pas être annulé. Vos commandes ne seront plus consultables ici, et un nouveau compte sur la même adresse repartira de zéro.',
  'settings.danger.action': 'Supprimer mon compte',
  'settings.danger.confirmTitle': 'Supprimer votre compte ?',
  'settings.danger.confirmBody':
    'Cela ferme définitivement {email}. Votre historique de commandes, vos adresses enregistrées et vos messages quittent ce téléphone, et vous réinscrire avec la même adresse ne les ramènera pas. Le bureau garde sa propre trace du travail déjà fait : demandez-nous si vous avez besoin d’un reçu pour une collecte passée.',
  'settings.danger.yourAccount': 'votre compte',
  'settings.danger.wallet':
    'Votre portefeuille contient encore {amount}. Ce montant n’est pas remboursé — fermer le compte le fait perdre. Dépensez-le sur une collecte si vous préférez l’éviter.',
  'settings.danger.planNamed':
    'Votre abonnement ({plan}) prend fin immédiatement, et le reste de la période déjà payée est perdu avec lui.',
  'settings.danger.plan':
    'Votre abonnement prend fin immédiatement, et le reste de la période déjà payée est perdu avec lui.',
  'settings.danger.typeToConfirm': 'Tapez {word} pour confirmer',
  'settings.danger.keep': 'Garder mon compte',
  'settings.danger.deleting': 'Suppression…',
  'settings.danger.delete': 'Supprimer définitivement',
  'settings.danger.failed':
    'Impossible de joindre FreshFold : rien n’a été supprimé. Vérifiez votre connexion et réessayez.',

  // --------------------------------------------------------------- compte
  'account.title': 'Compte',
  'account.notifications': 'Notifications',
  'account.settingsCaption': 'Vos informations, la sécurité, les adresses, les alertes',

  'account.verify.title': 'Confirmez votre e-mail',
  'account.verify.body':
    'Nous avons envoyé un lien à {email}. Confirmez-le pour commencer à réserver des collectes.',
  'account.verify.resend': 'Renvoyer le lien',
  'account.verify.sent': 'Envoyé. Regardez votre boîte de réception — et vos indésirables.',
  'account.verify.failed': 'Impossible d’envoyer le lien. Réessayez dans un instant.',

  'account.guestName': 'Invité',
  'account.guestBody':
    'Réserver marche sans compte — le compte est ce qui garde vos réservations, avec votre portefeuille et votre niveau de fidélité.',

  'account.stats.orders': 'Commandes',
  'account.stats.points': 'Points',
  'account.stats.wallet': 'Portefeuille',
  'account.stats.spent': 'Dépensé',

  'account.orders.title': 'Commandes récentes',
  // Les deux adjectifs s’accordent avec « commande », féminin.
  'account.orders.caption': '{active} en cours · {past} terminées',
  'account.orders.seeAll': 'Tout voir',
  'account.orders.emptyTitle': 'Aucune commande pour l’instant',
  'account.orders.emptyBody': 'Votre première collecte est à une minute d’ici.',

  'account.addresses.title': 'Adresses enregistrées',
  'account.addresses.caption':
    'Pré-remplit le formulaire de réservation. Choisissez laquelle dans les réglages.',

  'account.help.title': 'Aide',
  'account.help.caption': 'Une personne, pas un formulaire.',
  'account.help.foldie': 'Demander à Foldie',
  'account.help.foldieCaption': 'Assistant concierge, dans l’application',
  'account.help.rate': 'Noter FreshFold',
  'account.help.rateCaption': 'Dites-nous ce que vous en pensez',
  'account.help.feedbackSubject': 'Avis sur FreshFold',

  'account.signOut': 'Se déconnecter',
  'account.signOutTitle': 'Se déconnecter ?',
  'account.signOutBody':
    'Vos commandes restent sur le compte et reviennent dès que vous vous reconnectez.',
  'account.stay': 'Rester connecté',
  'account.build': 'Client FreshFold {version} · répartition sur {server}',

  // -------------------------------------------------- listes d’adresses
  'addresses.empty': 'Ajoutez votre première adresse',
  'addresses.edit': 'Modifier {label}',
  'addresses.remove': 'Supprimer {label}',
  'addresses.confirmRemove': 'Supprimer cette adresse ?',
  // {max} vient de `MAX_SAVED_ADDRESSES` : le plafond est celui du serveur, pas
  // un nombre recopié dans cinq dictionnaires.
  'addresses.full':
    'Le carnet d’adresses est limité à {max}. Supprimez-en une pour en ajouter une autre.',

  // -------------------------------------------------------- address sheet
  'address.add': 'Ajouter une adresse',
  'address.edit': 'Modifier l’adresse',
  'address.label': 'Libellé',
  'address.labelPlaceholder': 'Maison, résidence, bureau…',
  'address.address': 'Adresse',
  'address.addressPlaceholder': 'Evandy Hostel, Bloc B, Chambre 304',
  'address.city': 'Ville',
  'address.cityPlaceholder': 'Kumasi',
  'address.pinKept':
    'Le point que vous avez placé pour cette adresse est conservé. Modifier le texte ne le déplace pas.',
  'address.pinPlaced':
    'Choisie dans la liste : cette adresse reprend le point de ce lieu — indiquez ensuite le bloc et la chambre.',
  'address.pinDerived':
    'Le coursier se rend à un point déduit de ce texte — plus il est précis, plus il arrive près.',
  'address.zone': 'Zone de collecte',
  'address.zoneHint':
    'Le texte seul ne nous dit pas où c’est. Choisissez la zone où nous devons collecter, ou sélectionnez le lieu dans la liste ci-dessus.',
  'address.error.address': 'Indiquez l’adresse à laquelle le coursier doit se présenter.',
  'address.error.zone':
    'Choisissez une zone de collecte pour que nous sachions où envoyer le coursier.',
  'address.save': 'Enregistrer l’adresse',
  'address.saveChanges': 'Enregistrer les modifications',
  'address.fallbackLabel': 'Adresse de collecte',

  // ------------------------------------------------------ verrouillage
  'lock.title': 'FreshFold est verrouillé',
  'lock.body':
    'Vos commandes, votre portefeuille et vos adresses enregistrées sont derrière le verrou biométrique activé dans les réglages.',
  'lock.unlock': 'Déverrouiller',
  'lock.retry': 'Réessayer',
  'lock.prompt': 'Déverrouiller FreshFold',
  'lock.fallback': 'Utiliser le code de l’appareil',
  'lock.failed': 'Cela ne correspond pas.',
  'lock.unavailable':
    'Cet appareil n’a plus de biométrie enregistrée : le verrou ne peut donc plus être ouvert ici. Vous déconnecter garde FreshFold utilisable, et vos commandes restent sur votre compte.',
  'lock.signOut': 'Me déconnecter à la place',
};
