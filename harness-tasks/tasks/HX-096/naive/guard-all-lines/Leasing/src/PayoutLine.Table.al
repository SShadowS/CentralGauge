table 70342 "CGR Payout Line"
{
    DataClassification = CustomerContent;

    // One proposed payment. Share Line No. 0 is the owner's own line; any other value is the
    // payout of that third-party share.
    fields
    {
        field(1; "Line No."; Integer) { }
        field(2; "Statement Entry No."; Integer) { }
        field(3; "Share Line No."; Integer) { }
        field(4; "Payee Code"; Code[20]) { }
        field(5; Amount; Decimal) { }
        field(6; "To Be Paid"; Boolean)
        {
            trigger OnValidate()
            var
                PayoutSuggestion: Codeunit "CGR Payout Suggestion";
            begin
                if not "To Be Paid" then
                    exit;
                if PayoutSuggestion.OnlyHeldSharesRemain("Statement Entry No.") then
                    Error(SharesOnHoldErr, "Statement Entry No.");
            end;
        }
    }

    keys
    {
        key(PK; "Line No.") { Clustered = true; }
        key(Statement; "Statement Entry No.", "Share Line No.") { }
    }

    var
        SharesOnHoldErr: Label 'Statement %1 cannot be paid while all of its open third-party shares are on hold.', Comment = '%1 = statement entry no.';
}
