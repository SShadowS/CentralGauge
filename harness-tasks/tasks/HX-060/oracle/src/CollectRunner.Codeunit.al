codeunit 86662 "HX060 Collect Runner"
{
    var
        Pending: Record "CGR Outbox Entry" temporary;
        RunVehicleFilter: Text;
        AddedCount: Integer;

    trigger OnRun()
    var
        EntryFilter: Record "CGR Outbox Entry";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
    begin
        EntryFilter.SetFilter("Vehicle No.", RunVehicleFilter);
        AddedCount := Dispatcher.CollectPending(EntryFilter, Pending);
    end;

    procedure SetVehicleFilter(VehicleFilter: Text)
    begin
        RunVehicleFilter := VehicleFilter;
        AddedCount := -1;
    end;

    procedure AddToBuffer(Entry: Record "CGR Outbox Entry")
    begin
        Pending := Entry;
        Pending.Insert();
    end;

    procedure Added(): Integer
    begin
        exit(AddedCount);
    end;

    procedure BufferCount(): Integer
    begin
        Pending.Reset();
        exit(Pending.Count());
    end;
}
