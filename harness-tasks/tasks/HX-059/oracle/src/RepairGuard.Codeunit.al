// Spy on the damage entry: at the first repaired modify it records the hold as seen from inside the batch,
// and it raises for one configured entry (an extension refusing a repair).
codeunit 86641 "HX059 Repair Guard"
{
    EventSubscriberInstance = Manual;

    var
        WatchedVehicleNo: Code[20];
        ControlVehicleNo: Code[20];
        BlockedControlVehicleNo: Code[20];
        RefusedEntryNo: Integer;
        BlockedControlAvailable: Boolean;
        Fired: Boolean;
        EntryVehicleHeld: Boolean;
        WatchedHeld: Boolean;
        WatchedAvailable: Boolean;
        ControlAvailable: Boolean;
        RefusedErr: Label 'HX059 repair refused for %1.', Comment = '%1 = damage entry number';

    procedure Watch(NewWatchedVehicleNo: Code[20]; NewControlVehicleNo: Code[20]; NewBlockedControlVehicleNo: Code[20])
    begin
        WatchedVehicleNo := NewWatchedVehicleNo;
        ControlVehicleNo := NewControlVehicleNo;
        BlockedControlVehicleNo := NewBlockedControlVehicleNo;
    end;

    procedure BlockedControlWasAvailable(): Boolean
    begin
        exit(BlockedControlAvailable);
    end;

    procedure Refuse(EntryNo: Integer)
    begin
        RefusedEntryNo := EntryNo;
    end;

    procedure RefusalText(): Text
    begin
        exit(StrSubstNo(RefusedErr, RefusedEntryNo));
    end;

    procedure HasFired(): Boolean
    begin
        exit(Fired);
    end;

    procedure EntryVehicleWasHeld(): Boolean
    begin
        exit(EntryVehicleHeld);
    end;

    procedure WatchedWasHeld(): Boolean
    begin
        exit(WatchedHeld);
    end;

    procedure WatchedWasAvailable(): Boolean
    begin
        exit(WatchedAvailable);
    end;

    procedure ControlWasAvailable(): Boolean
    begin
        exit(ControlAvailable);
    end;

    [EventSubscriber(ObjectType::Table, Database::"CGR Damage Entry", 'OnAfterModifyEvent', '', false, false)]
    local procedure RecordRepair(var Rec: Record "CGR Damage Entry"; var xRec: Record "CGR Damage Entry"; RunTrigger: Boolean)
    var
        Hold: Codeunit "CGR Workshop Hold";
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        if Rec.IsTemporary() then
            exit;
        if not Rec.Repaired then
            exit;
        if not Fired then begin
            Fired := true;
            EntryVehicleHeld := Hold.IsHeld(Rec."Vehicle No.");
            WatchedHeld := Hold.IsHeld(WatchedVehicleNo);
            WatchedAvailable := FleetMgt.IsAvailable(WatchedVehicleNo);
            ControlAvailable := FleetMgt.IsAvailable(ControlVehicleNo);
            BlockedControlAvailable := FleetMgt.IsAvailable(BlockedControlVehicleNo);
        end;
        if (RefusedEntryNo <> 0) and (Rec."Entry No." = RefusedEntryNo) then
            Error(RefusedErr, RefusedEntryNo);
    end;
}
