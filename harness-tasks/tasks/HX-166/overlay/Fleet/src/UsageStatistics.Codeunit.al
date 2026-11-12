codeunit 70186 "CGR Usage Statistics"
{
    procedure UsageBandOf(KmOver: Integer): Code[10]
    begin
        if KmOver <= 0 then
            exit('NONE');
        if KmOver <= 1500 then
            exit('STANDARD');
        exit('HEAVY');
    end;

    procedure CountChargesInBand(PeriodStart: Date; BandCode: Code[10]): Integer
    var
        Charge: Record "CGR Usage Charge";
    begin
        Charge.SetRange("Period Start", PeriodStart);
        Charge.SetRange("Band Code", BandCode);
        exit(Charge.Count());
    end;
}
