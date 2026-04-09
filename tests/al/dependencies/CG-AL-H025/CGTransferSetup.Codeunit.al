codeunit 69042 "CG Transfer Setup"
{
    Subtype = Install;

    trigger OnInstallAppPerCompany()
    var
        Source: Record "CG Transfer Source";
    begin
        if Source.Count > 0 then
            exit;

        InsertSource(Source, 'SRC001', 'Alpha Product', 100.00, 'CAT-A', true);
        InsertSource(Source, 'SRC002', 'Beta Product', 250.50, 'CAT-A', true);
        InsertSource(Source, 'SRC003', 'Gamma Product', 0.00, 'CAT-B', false);
        InsertSource(Source, 'SRC004', 'Delta Product', 1500.00, 'CAT-A', true);
        InsertSource(Source, 'SRC005', 'Epsilon Product', 75.25, 'CAT-C', true);
        InsertSource(Source, 'SRC006', 'Zeta Product', 999.99, 'CAT-B', false);
        InsertSource(Source, 'SRC007', 'Eta Product', 50.00, 'CAT-C', true);
        InsertSource(Source, 'SRC008', 'Theta Product', 3200.00, 'CAT-A', true);
        InsertSource(Source, 'SRC009', 'Iota Product', 0.01, 'CAT-B', true);
        InsertSource(Source, 'SRC010', 'Kappa Product', 450.00, 'CAT-C', false);
    end;

    local procedure InsertSource(var Source: Record "CG Transfer Source"; CodeVal: Code[20]; Desc: Text[100]; Amt: Decimal; Cat: Code[20]; IsEnabled: Boolean)
    begin
        Source.Init();
        Source.Code := CodeVal;
        Source.Description := Desc;
        Source.Amount := Amt;
        Source.Category := Cat;
        Source.Enabled := IsEnabled;
        Source.Insert();
    end;
}
