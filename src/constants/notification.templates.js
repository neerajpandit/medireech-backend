import { NOTIFICATION_EVENT_TYPES, NOTIFICATION_LANGUAGES } from './notification.types.js';

const templates = {
  [NOTIFICATION_EVENT_TYPES.RESERVATION_CREATED]: {
    [NOTIFICATION_LANGUAGES.HI]: {
      title: 'नई दवा आरक्षण',
      message: 'आपके फार्मेसी में एक नया आरक्षण अनुरोध प्राप्त हुआ है।',
    },
    [NOTIFICATION_LANGUAGES.EN]: {
      title: 'New medicine reservation',
      message: 'Your pharmacy received a new reservation request.',
    },
  },
  [NOTIFICATION_EVENT_TYPES.RESERVATION_CONFIRMED]: {
    [NOTIFICATION_LANGUAGES.HI]: {
      title: 'आरक्षण पुष्टि',
      message: 'आपका आरक्षण फार्मेसी द्वारा स्वीकार कर लिया गया है।',
    },
    [NOTIFICATION_LANGUAGES.EN]: {
      title: 'Reservation confirmed',
      message: 'Your reservation has been confirmed by the pharmacy.',
    },
  },
  [NOTIFICATION_EVENT_TYPES.RESERVATION_REJECTED]: {
    [NOTIFICATION_LANGUAGES.HI]: {
      title: 'आरक्षण अस्वीकृत',
      message: 'आपका आरक्षण फार्मेसी द्वारा अस्वीकार कर दिया गया है।',
    },
    [NOTIFICATION_LANGUAGES.EN]: {
      title: 'Reservation rejected',
      message: 'Your reservation was rejected by the pharmacy.',
    },
  },
  [NOTIFICATION_EVENT_TYPES.RESERVATION_EXPIRED]: {
    [NOTIFICATION_LANGUAGES.HI]: {
      title: 'आरक्षण समाप्त',
      message: '15 मिनट की समय सीमा समाप्त होने के कारण आपका आरक्षण समाप्त हो गया है।',
    },
    [NOTIFICATION_LANGUAGES.EN]: {
      title: 'Reservation expired',
      message: 'Your reservation expired because the pharmacy response window ended.',
    },
  },
  [NOTIFICATION_EVENT_TYPES.RESERVATION_READY_FOR_PICKUP]: {
    [NOTIFICATION_LANGUAGES.HI]: {
      title: 'दवा तैयार',
      message: 'आपका आरक्षित ऑर्डर पिकअप के लिए तैयार है।',
    },
    [NOTIFICATION_LANGUAGES.EN]: {
      title: 'Ready for pickup',
      message: 'Your reserved order is ready for pickup.',
    },
  },
  [NOTIFICATION_EVENT_TYPES.RESERVATION_CANCELLED]: {
    [NOTIFICATION_LANGUAGES.HI]: {
      title: 'आरक्षण रद्द',
      message: 'एक आरक्षण रद्द कर दिया गया है।',
    },
    [NOTIFICATION_LANGUAGES.EN]: {
      title: 'Reservation cancelled',
      message: 'A reservation has been cancelled.',
    },
  },
  [NOTIFICATION_EVENT_TYPES.RESERVATION_COLLECTED]: {
    [NOTIFICATION_LANGUAGES.HI]: {
      title: 'आरक्षण पूर्ण',
      message: 'आपका आरक्षण सफलतापूर्वक संग्रहित कर लिया गया है।',
    },
    [NOTIFICATION_LANGUAGES.EN]: {
      title: 'Reservation collected',
      message: 'Your reservation was collected successfully.',
    },
  },
  [NOTIFICATION_EVENT_TYPES.PHARMACY_APPLICATION_APPROVED]: {
    [NOTIFICATION_LANGUAGES.HI]: {
      title: 'फार्मेसी स्वीकृत',
      message: 'आपका फार्मेसी आवेदन स्वीकृत हो गया है।',
    },
    [NOTIFICATION_LANGUAGES.EN]: {
      title: 'Pharmacy approved',
      message: 'Your pharmacy application has been approved.',
    },
  },
  [NOTIFICATION_EVENT_TYPES.PAYMENT_ORDER_CREATED]: {
    [NOTIFICATION_LANGUAGES.HI]: {
      title: 'भुगतान आदेश',
      message: 'आपके आरक्षण के लिए ऑनलाइन भुगतान आदेश तैयार है।',
    },
    [NOTIFICATION_LANGUAGES.EN]: {
      title: 'Payment order ready',
      message: 'An online payment order is ready for your reservation.',
    },
  },
  [NOTIFICATION_EVENT_TYPES.PAYMENT_SUCCESSFUL]: {
    [NOTIFICATION_LANGUAGES.HI]: {
      title: 'भुगतान सफल',
      message: 'आपका ऑनलाइन भुगतान सफलतापूर्वक प्राप्त हो गया है।',
    },
    [NOTIFICATION_LANGUAGES.EN]: {
      title: 'Payment successful',
      message: 'Your online payment was received successfully.',
    },
  },
  [NOTIFICATION_EVENT_TYPES.PAYMENT_FAILED]: {
    [NOTIFICATION_LANGUAGES.HI]: {
      title: 'भुगतान विफल',
      message: 'आपका ऑनलाइन भुगतान पूरा नहीं हो सका।',
    },
    [NOTIFICATION_LANGUAGES.EN]: {
      title: 'Payment failed',
      message: 'Your online payment could not be completed.',
    },
  },
  [NOTIFICATION_EVENT_TYPES.PAYMENT_EXPIRED]: {
    [NOTIFICATION_LANGUAGES.HI]: {
      title: 'भुगतान समय समाप्त',
      message: 'भुगतान की समय सीमा समाप्त हो गई है।',
    },
    [NOTIFICATION_LANGUAGES.EN]: {
      title: 'Payment expired',
      message: 'The payment window for your reservation has expired.',
    },
  },
  [NOTIFICATION_EVENT_TYPES.REFUND_INITIATED]: {
    [NOTIFICATION_LANGUAGES.HI]: {
      title: 'रिफंड शुरू',
      message: 'आपके भुगतान के लिए रिफंड प्रक्रिया शुरू की गई है।',
    },
    [NOTIFICATION_LANGUAGES.EN]: {
      title: 'Refund initiated',
      message: 'A refund has been initiated for your payment.',
    },
  },
  [NOTIFICATION_EVENT_TYPES.REFUND_SUCCESSFUL]: {
    [NOTIFICATION_LANGUAGES.HI]: {
      title: 'रिफंड सफल',
      message: 'आपका रिफंड सफलतापूर्वक संसाधित हो गया है।',
    },
    [NOTIFICATION_LANGUAGES.EN]: {
      title: 'Refund successful',
      message: 'Your refund has been processed successfully.',
    },
  },
  [NOTIFICATION_EVENT_TYPES.REFUND_FAILED]: {
    [NOTIFICATION_LANGUAGES.HI]: {
      title: 'रिफंड विफल',
      message: 'रिफंड संसाधित नहीं हो सका। सहायता से संपर्क करें।',
    },
    [NOTIFICATION_LANGUAGES.EN]: {
      title: 'Refund failed',
      message: 'Your refund could not be processed. Please contact support.',
    },
  },
  [NOTIFICATION_EVENT_TYPES.PHARMACY_APPLICATION_REJECTED]: {
    [NOTIFICATION_LANGUAGES.HI]: {
      title: 'फार्मेसी अस्वीकृत',
      message: 'आपका फार्मेसी आवेदन अस्वीकार कर दिया गया है।',
    },
    [NOTIFICATION_LANGUAGES.EN]: {
      title: 'Pharmacy rejected',
      message: 'Your pharmacy application was rejected.',
    },
  },
  [NOTIFICATION_EVENT_TYPES.SUPPORT_TICKET_CREATED]: {
    [NOTIFICATION_LANGUAGES.EN]: {
      title: 'New support ticket',
      message: 'A new customer support ticket was created.',
    },
    [NOTIFICATION_LANGUAGES.HI]: {
      title: 'नया सपोर्ट टिकट',
      message: 'एक नया ग्राहक सपोर्ट टिकट बनाया गया है।',
    },
  },
  [NOTIFICATION_EVENT_TYPES.SUPPORT_TICKET_ASSIGNED]: {
    [NOTIFICATION_LANGUAGES.EN]: {
      title: 'Ticket assigned to you',
      message: 'A support ticket has been assigned to you.',
    },
    [NOTIFICATION_LANGUAGES.HI]: {
      title: 'टिकट असाइन',
      message: 'एक सपोर्ट टिकट आपको सौंपा गया है।',
    },
  },
  [NOTIFICATION_EVENT_TYPES.SUPPORT_TICKET_ADMIN_REPLY]: {
    [NOTIFICATION_LANGUAGES.EN]: {
      title: 'Support team replied',
      message: 'The support team replied to your ticket.',
    },
    [NOTIFICATION_LANGUAGES.HI]: {
      title: 'सपोर्ट उत्तर',
      message: 'सपोर्ट टीम ने आपके टिकट का उत्तर दिया है।',
    },
  },
  [NOTIFICATION_EVENT_TYPES.SUPPORT_TICKET_USER_REPLY]: {
    [NOTIFICATION_LANGUAGES.EN]: {
      title: 'Customer replied',
      message: 'The ticket creator sent a new message.',
    },
    [NOTIFICATION_LANGUAGES.HI]: {
      title: 'ग्राहक उत्तर',
      message: 'टिकट बनाने वाले ने नया संदेश भेजा है।',
    },
  },
  [NOTIFICATION_EVENT_TYPES.SUPPORT_TICKET_RESOLVED]: {
    [NOTIFICATION_LANGUAGES.EN]: {
      title: 'Ticket updated',
      message: 'Your support ticket status was updated.',
    },
    [NOTIFICATION_LANGUAGES.HI]: {
      title: 'टिकट अपडेट',
      message: 'आपके सपोर्ट टिकट की स्थिति अपडेट की गई है।',
    },
  },
  [NOTIFICATION_EVENT_TYPES.SUPPORT_TICKET_REOPENED]: {
    [NOTIFICATION_LANGUAGES.EN]: {
      title: 'Ticket reopened',
      message: 'A resolved support ticket was reopened.',
    },
    [NOTIFICATION_LANGUAGES.HI]: {
      title: 'टिकट पुनः खोला',
      message: 'एक हल किया गया सपोर्ट टिकट फिर से खोला गया है।',
    },
  },
};

export const resolveNotificationContent = (eventType, language = NOTIFICATION_LANGUAGES.HI, variables = {}) => {
  const lang = language === NOTIFICATION_LANGUAGES.EN ? NOTIFICATION_LANGUAGES.EN : NOTIFICATION_LANGUAGES.HI;
  const template = templates[eventType]?.[lang] || templates[eventType]?.[NOTIFICATION_LANGUAGES.EN];

  if (!template) {
    return {
      title: 'MediReech',
      message: 'You have a new update.',
    };
  }

  let { title, message } = template;
  if (variables.reservationCode) {
    message = `${message} (${variables.reservationCode})`;
  }

  return { title, message };
};
