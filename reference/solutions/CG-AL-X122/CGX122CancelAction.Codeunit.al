codeunit 70826 "CG X122 Cancel Action"
{
    // Used when an operator manually cancels a single document. Wants a
    // CANCELLED activity entry for that one cancellation, so the notifier is
    // active only for the duration of this call.
    procedure CancelWithAlert(DocNo: Code[20])
    var
        Notifier: Codeunit "CG X122 Cancellation Alerter";
        Processor: Codeunit "CG X122 Document Processor";
        Bound: Boolean;
        Unbound: Boolean;
    begin
        Bound := BindSubscription(Notifier);
        Processor.CancelDocument(DocNo);
        Unbound := UnbindSubscription(Notifier);
    end;
}
