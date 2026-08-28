codeunit 70812 "CG X121 Contract Mgt"
{
    procedure GenerateInitialLines(var Header: Record "CG X121 Contract Header")
    begin
        Header."Lines Need Recreate" := true;
        RefreshLines(Header);
    end;

    procedure RefreshLines(var Header: Record "CG X121 Contract Header")
    var
        Line: Record "CG X121 Contract Line";
        PlanRate: Decimal;
        RegionFactor: Decimal;
        Period: Integer;
    begin
        if not Header."Lines Need Recreate" then
            exit;

        Line.SetRange("Contract No.", Header."No.");
        Line.DeleteAll();

        PlanRate := PlanRateFor(Header."Plan Code");
        RegionFactor := RegionFactorFor(Header."Region Code");

        for Period := 1 to 3 do begin
            Header."Last Line Entry No." += 1;
            Line.Init();
            Line."Entry No." := Header."Last Line Entry No.";
            Line."Contract No." := Header."No.";
            Line."Period No." := Period;
            Line.Amount := PlanRate * RegionFactor;
            Line.Insert();
        end;

        Header."Lines Need Recreate" := false;
        Header.Modify();
    end;

    local procedure PlanRateFor(PlanCode: Code[10]): Decimal
    begin
        case PlanCode of
            'BASIC':
                exit(100);
            'PLUS':
                exit(200);
            'PREMIUM':
                exit(300);
        end;
        exit(100);
    end;

    local procedure RegionFactorFor(RegionCode: Code[10]): Decimal
    begin
        case RegionCode of
            'EAST':
                exit(1.0);
            'WEST':
                exit(1.1);
            'NORTH':
                exit(1.2);
        end;
        exit(1.0);
    end;
}
