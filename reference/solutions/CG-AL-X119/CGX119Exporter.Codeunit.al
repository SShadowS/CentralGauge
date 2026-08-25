codeunit 70797 "CG X119 Exporter"
{
    procedure BuildExportLines(DocumentNo: Code[20])
    var
        Line: Record "CG X119 Doc Line";
        ExportLine: Record "CG X119 Export Line";
    begin
        ExportLine.SetRange("Document No.", DocumentNo);
        ExportLine.DeleteAll();

        Line.SetRange("Document No.", DocumentNo);
        if Line.FindSet() then
            repeat
                ExportLine.Init();
                ExportLine."Document No." := Line."Document No.";
                ExportLine."Line No." := Line."Line No.";
                ExportLine."Line Type" := Line."Line Type";
                case Line."Line Type" of
                    "CG X119 Line Type"::Item:
                        SetItemFields(Line, ExportLine);
                    "CG X119 Line Type"::GLAccount:
                        SetGLAccountFields(Line, ExportLine);
                    "CG X119 Line Type"::Resource:
                        SetResourceFields(Line, ExportLine);
                    "CG X119 Line Type"::Charge:
                        SetChargeFields(Line, ExportLine);
                end;
                ExportLine.Insert();
            until Line.Next() = 0;
    end;

    local procedure SetItemFields(var Line: Record "CG X119 Doc Line"; var ExportLine: Record "CG X119 Export Line")
    var
        Item: Record "CG X119 Item";
    begin
        if not Item.Get(Line."No.") then
            exit;
        if Item.Description <> '' then
            ExportLine.Name := Item.Description
        else
            ExportLine.Name := Item."Description 2";
        ExportLine."Seller ID" := Format(Line."Line No.");
        ExportLine."Unit of Measure Code" := GetUOMOrDefault(Item."Base Unit of Measure");
    end;

    local procedure SetGLAccountFields(var Line: Record "CG X119 Doc Line"; var ExportLine: Record "CG X119 Export Line")
    var
        GLAccount: Record "CG X119 GL Account";
    begin
        if not GLAccount.Get(Line."No.") then
            exit;
        ExportLine.Name := GLAccount.Name;
        ExportLine."Seller ID" := Format(Line."Line No.");
        // G/L accounts carry no unit of measure - leave it blank.
    end;

    local procedure SetResourceFields(var Line: Record "CG X119 Doc Line"; var ExportLine: Record "CG X119 Export Line")
    var
        Resource: Record "CG X119 Resource";
    begin
        if not Resource.Get(Line."No.") then
            exit;
        ExportLine.Name := Resource.Name;
        ExportLine."Seller ID" := Format(Line."Line No.");
        ExportLine."Unit of Measure Code" := GetUOMOrDefault(Resource."Base Unit of Measure");
    end;

    local procedure SetChargeFields(var Line: Record "CG X119 Doc Line"; var ExportLine: Record "CG X119 Export Line")
    var
        Charge: Record "CG X119 Charge";
    begin
        if not Charge.Get(Line."No.") then
            exit;
        if Charge.Description <> '' then
            ExportLine.Name := Charge.Description
        else
            ExportLine.Name := Charge."Description 2";
        ExportLine."Seller ID" := Format(Line."Line No.");
        ExportLine."Unit of Measure Code" := GetUOMOrDefault(Charge."Unit of Measure Code");
    end;

    local procedure GetUOMOrDefault(UOMCode: Code[10]): Code[10]
    begin
        if UOMCode <> '' then
            exit(UOMCode);
        exit('PCS');
    end;
}
