table 71520 "CG X168 Cost Group"
{
    DataClassification = CustomerContent;
    Caption = 'CG X168 Cost Group';

    fields
    {
        field(1; "Code"; Code[20])
        {
            Caption = 'Code';
            DataClassification = CustomerContent;
        }
        field(2; "Parent Code"; Code[20])
        {
            Caption = 'Parent Code';
            DataClassification = CustomerContent;
        }
        field(3; Name; Text[100])
        {
            Caption = 'Name';
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "Code")
        {
            Clustered = true;
        }
        key(ByParent; "Parent Code")
        {
        }
    }
}
