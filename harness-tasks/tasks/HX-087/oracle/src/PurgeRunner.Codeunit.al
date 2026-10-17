codeunit 87202 "HX087 Purge Runner"
{
    var
        RunMode: Option Entries,EntriesThenFail,Vehicle,CreatedBefore,PurgeSent;
        RunFilter: Text;
        RunChunk: Integer;
        RunUnsentOnly: Boolean;
        RunUnsentInGroup2: Boolean;
        RunGroupAfter: Integer;
        RunGroup2FiltersAfter: Text;
        RunVehicle: Code[20];
        RunBefore: DateTime;
        RunPurged: Integer;
        RunFiltersAfter: Text;
        LaterStepErr: Label 'HX087 later step failed.';

    trigger OnRun()
    var
        Entry: Record "CGR Outbox Entry";
        Facade: Codeunit "CGR Integration Facade";
    begin
        RunPurged := -1;
        case RunMode of
            RunMode::Entries, RunMode::EntriesThenFail:
                begin
                    Entry.SetFilter("Vehicle No.", RunFilter);
                    if RunUnsentOnly then
                        Entry.SetRange(Sent, false);
                    if RunUnsentInGroup2 then begin
                        Entry.FilterGroup(2);
                        Entry.SetRange(Sent, false);
                        Entry.FilterGroup(0);
                    end;
                    RunPurged := Facade.PurgeSentEntries(Entry, RunChunk);
                    RunGroupAfter := Entry.FilterGroup();
                    Entry.FilterGroup(0);
                    RunFiltersAfter := Entry.GetFilters();
                    Entry.FilterGroup(2);
                    RunGroup2FiltersAfter := Entry.GetFilters();
                    Entry.FilterGroup(0);
                    if RunMode = RunMode::EntriesThenFail then
                        Error(LaterStepErr);
                end;
            RunMode::Vehicle:
                RunPurged := Facade.PurgeSentForVehicle(RunVehicle);
            RunMode::CreatedBefore:
                RunPurged := Facade.PurgeSentBefore(RunBefore);
            RunMode::PurgeSent:
                Facade.PurgeSent();
        end;
    end;

    procedure HX087SetEntries(VehicleFilter: Text; ChunkSize: Integer; FailAfter: Boolean)
    begin
        RunFilter := VehicleFilter;
        RunChunk := ChunkSize;
        if FailAfter then
            RunMode := RunMode::EntriesThenFail
        else
            RunMode := RunMode::Entries;
    end;

    procedure HX087SetUnsentOnly()
    begin
        RunUnsentOnly := true;
    end;

    procedure HX087SetVehicle(VehicleNo: Code[20])
    begin
        RunVehicle := VehicleNo;
        RunMode := RunMode::Vehicle;
    end;

    procedure HX087SetBefore(CreatedBefore: DateTime)
    begin
        RunBefore := CreatedBefore;
        RunMode := RunMode::CreatedBefore;
    end;

    procedure HX087SetPurgeSent()
    begin
        RunMode := RunMode::PurgeSent;
    end;

    procedure HX087Purged(): Integer
    begin
        exit(RunPurged);
    end;

    procedure HX087FiltersAfter(): Text
    begin
        exit(RunFiltersAfter);
    end;

    procedure HX087SetUnsentInGroup2()
    begin
        RunUnsentInGroup2 := true;
    end;

    procedure HX087GroupAfter(): Integer
    begin
        exit(RunGroupAfter);
    end;

    procedure HX087Group2FiltersAfter(): Text
    begin
        exit(RunGroup2FiltersAfter);
    end;
}
