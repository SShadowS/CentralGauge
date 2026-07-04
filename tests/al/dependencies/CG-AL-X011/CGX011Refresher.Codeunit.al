codeunit 69711 "CG X011 Updater"
{
    procedure Apply(RecCode: Code[20])
    var
        Rec: Record "CG X011 Record";
    begin
        Rec.Get(RecCode);
        Rec.A := 10;
        Rec.B := 20;
        Rec.Modify();
    end;
}
