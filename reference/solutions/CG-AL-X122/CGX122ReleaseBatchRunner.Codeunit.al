codeunit 70824 "CG X122 Release Batch Runner"
{
    // Runs nightly. Wants a RELEASED activity entry for every document this
    // run releases, so the notifier is active only for the duration of the
    // run.
    procedure RunReleaseBatch()
    var
        Notifier: Codeunit "CG X122 Release Notifier";
        Processor: Codeunit "CG X122 Document Processor";
        Bound: Boolean;
        Unbound: Boolean;
    begin
        Bound := BindSubscription(Notifier);
        Processor.RunNightlyReleaseJob();
        Unbound := UnbindSubscription(Notifier);
    end;
}
