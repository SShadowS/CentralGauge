codeunit 70270 "CG M045 Watched Subscriber"
{
    [EventSubscriber(ObjectType::Table, Database::"CG M045 Watched Record", OnAfterValidateEvent, "Watched Code", false, false)]
    local procedure OnAfterValidateWatchedCode(var Rec: Record "CG M045 Watched Record"; var xRec: Record "CG M045 Watched Record"; CurrFieldNo: Integer)
    var
        FireCounter: Codeunit "CG M045 Fire Counter";
    begin
        if Rec."Watched Code" <> xRec."Watched Code" then
            FireCounter.Increment();
    end;
}