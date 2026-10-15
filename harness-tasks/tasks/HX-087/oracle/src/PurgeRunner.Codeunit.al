codeunit 87202 "HX087 Purge Runner"
{
    var
        RunMode: Option Entries,EntriesThenFail,Vehicle,CreatedBefore,PurgeSent;
        RunFilter: Text;
        RunChunk: Integer;
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
                    RunPurged := Facade.PurgeSentEntries(Entry, RunChunk);
                    RunFiltersAfter := Entry.GetFilters();
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
}
