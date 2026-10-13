// Ends a hold binding left by an earlier row. Run isolated so that a hold design whose unbind raises
// (for example a hold that is not bound manually) cannot fail the row's cleanup.
codeunit 86643 "HX059 Hold Cleaner"
{
    trigger OnRun()
    var
        Hold: Codeunit "CGR Workshop Hold";
    begin
        UnbindSubscription(Hold);
    end;
}
