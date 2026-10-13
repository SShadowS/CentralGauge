codeunit 86444 "HX049 Dispatch Runner"
{
    var
        RunEntryNo: Integer;
        RunVehicleFilter: Text;
        RunPending: Boolean;
        EntryDelivered: Boolean;
        PendingDelivered: Integer;

    trigger OnRun()
    var
        Entry: Record "CGR Outbox Entry";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
    begin
        if RunPending then begin
            Entry.SetFilter("Vehicle No.", RunVehicleFilter);
            PendingDelivered := Dispatcher.DispatchPending(Entry);
        end else
            EntryDelivered := Dispatcher.DispatchEntry(RunEntryNo);
    end;

    procedure SetEntry(EntryNo: Integer)
    begin
        RunPending := false;
        RunEntryNo := EntryNo;
        EntryDelivered := false;
    end;

    procedure SetPending(VehicleFilter: Text)
    begin
        RunPending := true;
        RunVehicleFilter := VehicleFilter;
        PendingDelivered := -1;
    end;

    procedure EntryResult(): Boolean
    begin
        exit(EntryDelivered);
    end;

    procedure PendingResult(): Integer
    begin
        exit(PendingDelivered);
    end;
}
