codeunit 70268 "CGR Desk Attempts"
{
    SingleInstance = true;

    procedure Failures(): Integer
    var
        Tally: Record "CGR Desk Failure Tally";
    begin
        if not Tally.Get('DESK') then
            exit(0);
        exit(Tally.Failures);
    end;

    procedure AddFailure()
    var
        Tally: Record "CGR Desk Failure Tally";
    begin
        if not Tally.Get('DESK') then begin
            Tally.Init();
            Tally."Desk Code" := 'DESK';
            Tally.Insert();
        end;
        Tally.Failures += 1;
        Tally.Modify();
    end;

    procedure Reset()
    var
        Tally: Record "CGR Desk Failure Tally";
    begin
        if Tally.Get('DESK') then
            Tally.Delete();
    end;
}
