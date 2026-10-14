codeunit 86443 "HX049 Transport Spy"
{
    SingleInstance = true;

    var
        CurrentMode: Integer;
        CallCount: Integer;
        LastEntryNo: Integer;

    procedure Reset()
    begin
        CurrentMode := DeliverMode();
        CallCount := 0;
        LastEntryNo := 0;
    end;

    procedure SetMode(NewMode: Integer)
    begin
        CurrentMode := NewMode;
    end;

    procedure Mode(): Integer
    begin
        exit(CurrentMode);
    end;

    procedure DeliverMode(): Integer
    begin
        exit(0);
    end;

    procedure RefuseMode(): Integer
    begin
        exit(1);
    end;

    procedure ErrorMode(): Integer
    begin
        exit(2);
    end;

    procedure RecordCall(EntryNo: Integer)
    begin
        CallCount += 1;
        LastEntryNo := EntryNo;
    end;

    procedure Calls(): Integer
    begin
        exit(CallCount);
    end;

    procedure LastEntry(): Integer
    begin
        exit(LastEntryNo);
    end;
}
