codeunit 70140 "CGR Yard Finding Sync"
{
    [EventSubscriber(ObjectType::Table, Database::"CGR Yard Finding", 'OnAfterInsertEvent', '', false, false)]
    local procedure CountNewFinding(var Rec: Record "CGR Yard Finding"; RunTrigger: Boolean)
    begin
        if Rec.IsTemporary() or Rec.Closed then
            exit;
        ChangeTally(Rec."Vehicle No.", 1);
    end;

    [EventSubscriber(ObjectType::Table, Database::"CGR Yard Finding", 'OnAfterDeleteEvent', '', false, false)]
    local procedure CountRemovedFinding(var Rec: Record "CGR Yard Finding"; RunTrigger: Boolean)
    begin
        if Rec.IsTemporary() or Rec.Closed then
            exit;
        ChangeTally(Rec."Vehicle No.", -1);
    end;

    local procedure ChangeTally(VehicleNo: Code[20]; Delta: Integer)
    var
        Tally: Record "CGR Yard Finding Tally";
    begin
        if not Tally.Get(VehicleNo) then begin
            Tally.Init();
            Tally."Vehicle No." := VehicleNo;
            Tally.Insert();
        end;
        Tally."Open Findings" += Delta;
        Tally.Modify();
        if (Delta < 0) and (Tally."Open Findings" = 0) then begin
            Commit();
            OnVehicleClearOfFindings(VehicleNo);
        end;
    end;

    [IntegrationEvent(false, false)]
    local procedure OnVehicleClearOfFindings(VehicleNo: Code[20])
    begin
    end;
}
