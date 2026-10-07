function returnPolicy(policy, shipping = {}) {
  if (policy && Number.isInteger(policy.days) && policy.days >= 14 && policy.days <= 365 && ['customer','store'].includes(policy.withdrawal_payer) && typeof policy.version === 'string') {
    return { version: policy.version, days: policy.days, withdrawal_payer: policy.withdrawal_payer, fault_payer: 'store' };
  }
  return { version: 'initial', days: Math.max(30, Math.min(365, Number.isInteger(shipping.returns_days) ? shipping.returns_days : 30)), withdrawal_payer: 'customer', fault_payer: 'store' };
}
module.exports = { returnPolicy };
