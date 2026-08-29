table 71320 "CG X148 Volume Agreement"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { }
        field(2; "Customer No."; Code[20]) { }
        field(3; "Currency Code"; Code[10]) { }
        field(4; "Effective Date"; Date) { }
        field(5; Notes; Text[100]) { }
        field(6; "Rebate Group"; Code[10]) { }
    }

    keys
    {
        key(PK; "No.")
        {
            Clustered = true;
        }
    }
}
