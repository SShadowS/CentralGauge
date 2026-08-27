codeunit 71000 "CG X011 Modifier"
{
    Access = Internal;

    procedure SetCViaRefresher(RecCode: Code[20]; NewC: Integer)
    var
        CGX011Record: Record "CG X011 Record";
        CGX011Refresher: Codeunit "CG X011 Refresher";
    begin
        CGX011Refresher.Recalculate(RecCode);

        CGX011Record.Get(RecCode);
        CGX011Record.Validate(C, NewC);
        CGX011Record.Modify(true);
    end;
}