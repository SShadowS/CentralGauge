table 70260 "CGR Customer Payment Entry"
{
    DataClassification = CustomerContent;

    // A customer payment received for a rental contract, in the currency of the payment.
    fields
    {
        field(1; "Entry No."; Integer) { }
        field(2; "Contract No."; Code[20]) { }
        field(3; "Currency Code"; Code[10]) { }
        field(4; "Remaining Amount"; Decimal) { }
        field(5; "Applies-to ID"; Code[20]) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
        key(Contract; "Contract No.", "Applies-to ID") { }
    }
}
