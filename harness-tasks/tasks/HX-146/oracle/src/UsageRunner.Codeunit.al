codeunit 88151 "HX146 Usage Runner"
{
    var
        Buffer: Record "CGR Monthly Usage Buffer" temporary;
        PeriodStart: Date;
        PeriodEnd: Date;

    procedure SetPeriod(NewPeriodStart: Date; NewPeriodEnd: Date)
    begin
        PeriodStart := NewPeriodStart;
        PeriodEnd := NewPeriodEnd;
    end;

    procedure AddSentinel(VehicleNo: Code[20])
    begin
        Buffer.Init();
        Buffer."Vehicle No." := VehicleNo;
        Buffer.Revenue := 999;
        Buffer."Km Driven" := 999;
        Buffer.Rentals := 9;
        Buffer.Insert();
    end;

    procedure CopyBuffer(var Target: Record "CGR Monthly Usage Buffer" temporary)
    begin
        Target.Reset();
        Target.DeleteAll();
        Buffer.Reset();
        if Buffer.FindSet() then
            repeat
                Target := Buffer;
                Target.Insert();
            until Buffer.Next() = 0;
    end;

    trigger OnRun()
    var
        UsageReport: Codeunit "CGR Monthly Usage Report";
    begin
        UsageReport.FillMonthlyUsage(PeriodStart, PeriodEnd, Buffer);
    end;
}
