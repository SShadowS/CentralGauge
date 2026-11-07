codeunit 70221 "CGR Contract Block Check"
{
    SingleInstance = true;

    var
        Suspended: Boolean;
        BlockedErr: Label 'Vehicle %1 is blocked; open contract %2 cannot be changed.', Comment = '%1 = vehicle number, %2 = contract number';

    procedure SuspendOnce()
    begin
        Suspended := true;
    end;

    [EventSubscriber(ObjectType::Table, Database::"CGR Rental Contract", 'OnAfterModifyEvent', '', false, false)]
    local procedure CheckBlocked(var Rec: Record "CGR Rental Contract"; var xRec: Record "CGR Rental Contract"; RunTrigger: Boolean)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        if Rec.IsTemporary() then
            exit;
        if Suspended then begin
            Suspended := false;
            exit;
        end;
        if Rec.Status <> Rec.Status::Open then
            exit;
        if Vehicle.Get(Rec."Vehicle No.") and Vehicle.Blocked then
            Error(BlockedErr, Rec."Vehicle No.", Rec."No.");
    end;
}
