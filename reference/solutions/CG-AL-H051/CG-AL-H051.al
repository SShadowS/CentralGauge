codeunit 70510 "CG H051 Tagger"
{
    Access = Public;

    procedure CountTagged(var Sample: Record "CG H051 Sample"; Codes: List of [Code[20]]) Result: Integer
    var
        SampleCode: Code[20];
    begin
        foreach SampleCode in Codes do
            if Sample.Get(SampleCode) then
                Sample.Mark(true);

        Sample.MarkedOnly(true);
        Result := Sample.Count();
    end;
}