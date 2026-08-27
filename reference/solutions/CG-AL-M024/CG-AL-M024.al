codeunit 70124 "CG JSON Path Selector"
{
    Access = Public;

    procedure SelectAllNames(): List of [Text]
    var
        Employees: JsonArray;
        EmployeeToken: JsonToken;
        EmployeeObject: JsonObject;
        NameToken: JsonToken;
        Names: List of [Text];
    begin
        Employees := BuildEmployeeArray();

        foreach EmployeeToken in Employees do begin
            EmployeeObject := EmployeeToken.AsObject();
            if EmployeeObject.Get('name', NameToken) then
                Names.Add(NameToken.AsValue().AsText());
        end;

        exit(Names);
    end;

    procedure SelectByIndex(Index: Integer): Text
    var
        Employees: JsonArray;
        EmployeeToken: JsonToken;
        EmployeeObject: JsonObject;
        NameToken: JsonToken;
    begin
        Employees := BuildEmployeeArray();

        if (Index < 0) or (Index >= Employees.Count()) then
            exit('');

        if not Employees.Get(Index, EmployeeToken) then
            exit('');

        EmployeeObject := EmployeeToken.AsObject();
        if EmployeeObject.Get('name', NameToken) then
            exit(NameToken.AsValue().AsText());

        exit('');
    end;

    procedure CountMatchingTokens(Department: Text): Integer
    var
        Employees: JsonArray;
        EmployeeToken: JsonToken;
        EmployeeObject: JsonObject;
        DepartmentToken: JsonToken;
        MatchCount: Integer;
    begin
        Employees := BuildEmployeeArray();
        MatchCount := 0;

        foreach EmployeeToken in Employees do begin
            EmployeeObject := EmployeeToken.AsObject();
            if EmployeeObject.Get('department', DepartmentToken) then
                if DepartmentToken.AsValue().AsText() = Department then
                    MatchCount += 1;
        end;

        exit(MatchCount);
    end;

    procedure SelectNestedValues(): Decimal
    var
        RootObject: JsonObject;
        Orders: JsonArray;
        OrderToken: JsonToken;
        OrderObject: JsonObject;
        OrdersToken: JsonToken;
        AmountToken: JsonToken;
        TotalAmount: Decimal;
    begin
        Orders.Add(BuildOrderObject(1, 150.50));
        Orders.Add(BuildOrderObject(2, 299.99));
        Orders.Add(BuildOrderObject(3, 75.00));
        RootObject.Add('orders', Orders);

        TotalAmount := 0;

        if RootObject.Get('orders', OrdersToken) then
            foreach OrderToken in OrdersToken.AsArray() do begin
                OrderObject := OrderToken.AsObject();
                if OrderObject.Get('amount', AmountToken) then
                    TotalAmount += AmountToken.AsValue().AsDecimal();
            end;

        exit(TotalAmount);
    end;

    local procedure BuildEmployeeArray(): JsonArray
    var
        Employees: JsonArray;
    begin
        Employees.Add(BuildEmployeeObject('Alice', 'Engineering', 85000));
        Employees.Add(BuildEmployeeObject('Bob', 'Marketing', 72000));
        Employees.Add(BuildEmployeeObject('Charlie', 'Engineering', 91000));
        exit(Employees);
    end;

    local procedure BuildEmployeeObject(Name: Text; Department: Text; Salary: Decimal): JsonObject
    var
        EmployeeObject: JsonObject;
    begin
        EmployeeObject.Add('name', Name);
        EmployeeObject.Add('department', Department);
        EmployeeObject.Add('salary', Salary);
        exit(EmployeeObject);
    end;

    local procedure BuildOrderObject(Id: Integer; Amount: Decimal): JsonObject
    var
        OrderObject: JsonObject;
    begin
        OrderObject.Add('id', Id);
        OrderObject.Add('amount', Amount);
        exit(OrderObject);
    end;
}